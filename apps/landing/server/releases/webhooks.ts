/**
 * GitHub webhook endpoint for the Release Manager.
 *
 * What it does:
 *   - verifies the documented `X-Hub-Signature-256` HMAC over the raw bytes before anything in the
 *     payload is believed;
 *   - records the delivery id, so a redelivery is acknowledged and ignored instead of applied
 *     twice;
 *   - keeps a linked pull request, release or deployment in step with what GitHub reports;
 *   - never publishes anything on its own, unless an administrator has already approved the
 *     release *and* automatic publication has been explicitly enabled.
 *
 * What it deliberately does not do: publish a release because a pull request was merged, or treat a
 * green build as a successful deployment.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { DeploymentState, ReleaseStore } from './contracts.ts';
import { verifyGitHubSignature, normaliseDeploymentState } from './github.ts';
import type { ReleaseService } from './service.ts';

const MAX_BODY_BYTES = 256 * 1024;

export interface GitHubWebhookDeps {
  store: ReleaseStore;
  service: ReleaseService;
  /** The webhook signing secret. Without it the endpoint refuses every delivery. */
  secret: string | null;
  /** Explicit opt-in for automatic publication after a successful deployment. */
  autoPublish: boolean;
  onError?: (label: string, error: unknown) => void;
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface PullRequestEvent {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    state?: string;
    merged?: boolean;
    html_url?: string;
    labels?: Array<{ name?: string }>;
  };
}

interface DeploymentEvent {
  action?: string;
  deployment?: {
    id?: number;
    ref?: string;
    sha?: string;
    environment?: string;
    task?: string;
    description?: string | null;
    statuses_url?: string;
  };
}

interface DeploymentStatusEvent {
  action?: string;
  deployment?: { id?: number; ref?: string; sha?: string; environment?: string };
  deployment_status?: { state?: string; description?: string | null; environment_url?: string | null };
}

interface ReleaseEvent {
  action?: string;
  release?: { tag_name?: string; name?: string | null; html_url?: string; draft?: boolean; prerelease?: boolean };
}

export async function handleGitHubWebhook(
  deps: GitHubWebhookDeps,
  rawBody: string,
  headers: { event?: string; delivery?: string; signature?: string },
): Promise<WebhookOutcome> {
  if (!deps.secret) {
    return { status: 503, body: { ok: false, error: 'The GitHub webhook secret is not configured on this server.' } };
  }
  if (!verifyGitHubSignature(rawBody, headers.signature, deps.secret)) {
    return { status: 401, body: { ok: false, error: 'Invalid signature.' } };
  }
  const delivery = headers.delivery?.trim();
  if (!delivery) return { status: 400, body: { ok: false, error: 'Missing delivery id.' } };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid payload.' } };
  }
  if (!payload || typeof payload !== 'object') {
    return { status: 400, body: { ok: false, error: 'Invalid payload.' } };
  }

  const event = headers.event?.trim() || 'unknown';
  const fresh = await deps.store.recordWebhookDelivery({ deliveryId: delivery, eventType: event });
  if (!fresh) {
    // GitHub retries a delivery it did not see acknowledged. A repeat is a no-op, not an error.
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  try {
    switch (event) {
      case 'pull_request': {
        const body = payload as PullRequestEvent;
        const number = body.pull_request?.number;
        if (typeof number !== 'number') break;
        const source = await deps.store.findSourceByExternalId({ provider: 'github', kind: 'pull_request', externalId: String(number) });
        if (!source) break;
        await deps.store.updateSource(source.id, {
          title: body.pull_request?.title ?? source.title,
          detail: body.pull_request?.body ? body.pull_request.body.slice(0, 2_000) : source.detail,
          state: body.pull_request?.merged ? 'merged' : (body.pull_request?.state ?? source.state),
          labels: (body.pull_request?.labels ?? []).map(label => label.name ?? '').filter(Boolean),
          updatedAt: new Date(),
        });
        break;
      }
      case 'deployment': {
        const body = payload as DeploymentEvent;
        const id = body.deployment?.id;
        if (typeof id !== 'number') break;
        const source = await deps.store.findSourceByExternalId({ provider: 'github', kind: 'deployment', externalId: String(id) });
        if (!source) break;
        await deps.store.updateSource(source.id, {
          deploymentEnvironment: body.deployment?.environment ?? source.deploymentEnvironment,
          deploymentRef: body.deployment?.ref ?? source.deploymentRef,
          deploymentSha: body.deployment?.sha ?? source.deploymentSha,
          updatedAt: new Date(),
        });
        break;
      }
      case 'deployment_status': {
        const body = payload as DeploymentStatusEvent;
        const id = body.deployment?.id;
        if (typeof id !== 'number') break;
        const observed = normaliseDeploymentState(body.deployment_status?.state);
        const state = observed as DeploymentState;
        const source = await deps.store.findSourceByExternalId({ provider: 'github', kind: 'deployment', externalId: String(id) });
        if (!source) break;
        await deps.store.updateSource(source.id, {
          deploymentState: state,
          deploymentEnvironment: body.deployment?.environment ?? source.deploymentEnvironment,
          deploymentRef: body.deployment?.ref ?? source.deploymentRef,
          deploymentSha: body.deployment?.sha ?? source.deploymentSha,
          state,
          updatedAt: new Date(),
        });
        if (state === 'success' && deps.autoPublish) {
          await publishApprovedRelease(deps, source.releaseId);
        }
        break;
      }
      case 'release': {
        const body = payload as ReleaseEvent;
        const tag = readString(body.release?.tag_name);
        if (!tag) break;
        const source = await deps.store.findSourceByExternalId({ provider: 'github', kind: 'release', externalId: tag });
        if (!source) break;
        await deps.store.updateSource(source.id, {
          title: body.release?.name ?? source.title,
          state: body.release?.draft ? 'draft' : 'published',
          updatedAt: new Date(),
        });
        break;
      }
      case 'ping':
        break;
      default:
        break;
    }
  } catch (error) {
    deps.onError?.('GitHub release webhook failed', error);
    return { status: 500, body: { ok: false, error: 'The webhook could not be applied.' } };
  }

  return { status: 200, body: { ok: true } };
}

/**
 * Automatic publication, only when it has been explicitly enabled *and* an administrator already
 * approved the release. The system is recorded as the actor so the audit trail says who did it.
 */
async function publishApprovedRelease(deps: GitHubWebhookDeps, releaseId: string): Promise<void> {
  const detail = await deps.service.get(releaseId);
  if (!detail) return;
  const status = detail.release.status;
  if (status !== 'approved' && status !== 'awaiting_deployment') return;
  const readiness = await deps.service.readiness(releaseId);
  if (!readiness.ready) return;
  try {
    await deps.service.transition(
      { id: 'system', name: 'Release automation', email: 'automation@intake.local' },
      releaseId,
      'publish',
      'Published automatically after the linked deployment succeeded.',
    );
  } catch (error) {
    deps.onError?.('Automatic release publication failed', error);
  }
}

/** Express handler. Mounted on a raw-body route: the signature covers bytes, not a parsed object. */
export function githubWebhookHandler(deps: GitHubWebhookDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      for await (const chunk of req) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          break;
        }
        chunks.push(buffer);
      }
      if (aborted) {
        res.status(413).json({ ok: false, error: 'Webhook payload is too large.' });
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const result = await handleGitHubWebhook(deps, raw, {
        event: req.get('x-github-event') ?? undefined,
        delivery: req.get('x-github-delivery') ?? undefined,
        signature: req.get('x-hub-signature-256') ?? undefined,
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      // The webhook must always answer. A handler that throws without answering leaves GitHub
      // waiting until it gives up, which is indistinguishable from an unreachable server — and it
      // hides the real error. A failure here is reported as a 500 and logged.
      deps.onError?.('GitHub release webhook failed', error);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'The webhook could not be applied.' });
      }
    }
  };
}

export function newWebhookId(): string {
  return `whk_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
