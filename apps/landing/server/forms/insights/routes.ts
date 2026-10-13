/**
 * Response insights: per-form answer summaries, computed on demand.
 *
 * GET /api/forms/:id/insights answers one question — "what did people say?" —
 * without ever storing a respondent answer. The flow is gated three deep:
 * the form must belong to the caller, the plan must be Pro, and the Google
 * grant must include the opt-in responses.readonly scope. Anything missing
 * yields a plain error code the UI turns into the matching next step
 * (upgrade, enable summaries, or reconnect).
 *
 * Raw answers live only in local variables between the Google fetch and the
 * summarizer. Nothing is written to any table, log, or AI provider.
 */

import { Router, type Request } from 'express';
import type { PublicLibraryForm } from '../../../src/lib/forms';
import type { Entitlement } from '../../credits/entitlements';
import { isProActive } from '../../credits/entitlements';
import { hasScope } from '../../providers/oauth';
import { FORMS_RESPONSES_READONLY_SCOPE } from '../providers/google/adapter';
import { createGoogleFormsClient, GoogleFormsApiError, type GoogleFormsClient, GoogleFormItemResource } from '../providers/google/client';
import type { AuthorizedConnection } from '../../providers/service';
import type { SessionUser } from '../../providers/service';
import { consumeRequestLimit, setRateLimitHeaders, type RateLimitStore } from '../../security/rate-limit';
import { summarizeResponses, type FormInsights, type InsightQuestion } from './summary';

export interface InsightsRouterDeps {
  getSession: (req: Request) => Promise<SessionUser | null>;
  getForm: (userId: string, id: string) => Promise<{ ok: true; form: PublicLibraryForm } | { ok: false }>;
  entitlement: (userId: string) => Promise<Pick<Entitlement, 'plan' | 'subscriptionStatus'>>;
  getConnection: (userId: string, provider: string) => Promise<AuthorizedConnection>;
  googleClient?: GoogleFormsClient;
  abuseLimiter?: RateLimitStore;
}

/** At most 5 pages of 200: summaries stay bounded no matter how popular the form. */
const MAX_PAGES = 5;

function questionKind(questionType: string | undefined): InsightQuestion['kind'] {
  if (questionType === 'multiple_choice' || questionType === 'dropdown' || questionType === 'checkboxes') return 'choice';
  if (questionType === 'scale' || questionType === 'rating') return 'scale';
  if (questionType === 'short_text' || questionType === 'long_text' || questionType === 'date' || questionType === 'time') return 'text';
  return 'other';
}

export function createInsightsRouter(deps: InsightsRouterDeps): Router {
  const router = Router();
  const google = deps.googleClient ?? createGoogleFormsClient();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  router.get('/:id/insights', async (req, res) => {
    const user = await deps.getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'You are not signed in. Sign in, then try again.' });

    if (deps.abuseLimiter) {
      try {
        const decision = await consumeRequestLimit(deps.abuseLimiter, 'forms.provider_read', user.id, req);
        if (!decision.ok) {
          if (decision.reason === 'rate_limited') setRateLimitHeaders(res, decision.retryAfterSeconds);
          return res.status(decision.reason === 'rate_limited' ? 429 : 503).json({ error: 'Too many requests. Wait briefly and try again.' });
        }
      } catch {
        return res.status(503).json({ error: 'Insights are temporarily unavailable.' });
      }
    }

    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const found = await deps.getForm(user.id, id).catch(() => null);
    // One shape for missing, foreign, non-Google, and unfinished forms alike:
    // existence and ownership are never distinguishable from outside.
    if (!found || !found.ok || found.form.provider !== 'google' || found.form.status !== 'created' || !found.form.providerFormId) {
      return res.status(404).json({ error: 'Form not found.' });
    }
    const form = found.form;

    const entitlement = await deps.entitlement(user.id).catch(() => null);
    if (!entitlement || !isProActive(entitlement)) {
      return res.status(403).json({ error: 'Response insights need Pro.', code: 'pro_required' });
    }

    const connection = await deps.getConnection(user.id, 'google').catch(() => null);
    if (!connection || connection.ok !== true) {
      return res.status(403).json({ error: 'Reconnect Google Forms first.', code: 'reauthorization_required' });
    }
    if (!hasScope(connection.scopes, FORMS_RESPONSES_READONLY_SCOPE)) {
      return res.status(403).json({ error: 'Enable response summaries first.', code: 'responses_scope_required' });
    }

try {
        const resource = await google.getForm(connection.accessToken, form.providerFormId);
        const items = resource.items ?? [];
        const questionTypePredicate = (item: unknown): item is GoogleFormItemResource => !!item && typeof item === 'object' && 'kind' in item && (item as GoogleFormItemResource).kind === 'question';
        const questions: InsightQuestion[] = items
          .filter(questionTypePredicate)
          .map(item => ({
            id: (item as GoogleFormItemResource).questionId!,
            title: (item as GoogleFormItemResource).title,
            kind: questionKind((item as GoogleFormItemResource).questionType),
            options: (item as GoogleFormItemResource).options?.map(opt => opt.value).filter(Boolean) as string[],
          }));
      const allAnswers: Array<Record<string, string[]>> = [];
      let pageToken: string | undefined;
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await google.listResponses(connection.accessToken, form.providerFormId, pageToken);
        allAnswers.push(...batch.answers);
        pageToken = batch.nextPageToken ?? undefined;
        if (!pageToken) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      const summary: FormInsights = summarizeResponses(questions, allAnswers);
      summary.truncated = truncated;
      return res.json({ status: 'ready', formId: form.id, title: form.title, insights: summary });
    } catch (error) {
      const status = error instanceof GoogleFormsApiError ? error.info.httpStatus : null;
      if (status === 401 || status === 403) {
        return res.status(403).json({ error: 'Google refused the request. Reconnect Google Forms.', code: 'reauthorization_required' });
      }
      return res.status(502).json({ error: 'Google did not answer. Try again shortly.' });
    }
  });

  return router;
}
