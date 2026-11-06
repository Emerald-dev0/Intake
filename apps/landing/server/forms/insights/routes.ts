/**
 * Response insights and the response export: per-form answers, read on demand.
 *
 * GET /api/forms/:id/insights          — "what did people say?", summarized.
 * GET /api/forms/:id/insights/export.csv — "give me all of it", as a file.
 *
 * Both are gated the same three deep: the form must belong to the caller, the plan must be Pro,
 * and the Google grant must include the opt-in responses.readonly scope. Anything missing yields a
 * plain error code the UI turns into the matching next step (upgrade, enable response reading, or
 * reconnect). The export has no looser door than the summary — a file is not a way around a check.
 *
 * Raw answers live only in local variables between the Google fetch and the response. Nothing is
 * written to any table, log, or AI provider, and no answer text ever reaches a log line.
 */

import { Router, type Request, type Response } from 'express';
import type { PublicLibraryForm } from '../../../src/lib/forms';
import type { Entitlement } from '../../credits/entitlements';
import { isProActive } from '../../credits/entitlements';
import { hasScope } from '../../providers/oauth';
import { FORMS_RESPONSES_READONLY_SCOPE } from '../providers/google/adapter';
import { createGoogleFormsClient, GoogleFormsApiError, type GoogleFormsClient, GoogleFormItemResource } from '../providers/google/client';
import { withRetry } from '../providers/google/retry';
import type { AuthorizedConnection } from '../../providers/service';
import type { SessionUser } from '../../providers/service';
import { consumeRequestLimit, setRateLimitHeaders, type AbuseScope, type RateLimitStore } from '../../security/rate-limit';
import { csvFilename, csvPreamble, csvResponseLine, type ExportQuestion } from './export';
import { summarizeResponses, type FormInsights, type InsightQuestion } from './summary';

export interface InsightsRouterDeps {
  getSession: (req: Request) => Promise<SessionUser | null>;
  getForm: (userId: string, id: string) => Promise<{ ok: true; form: PublicLibraryForm } | { ok: false }>;
  entitlement: (userId: string) => Promise<Pick<Entitlement, 'plan' | 'subscriptionStatus'>>;
  getConnection: (userId: string, provider: string) => Promise<AuthorizedConnection>;
  googleClient?: GoogleFormsClient;
  abuseLimiter?: RateLimitStore;
  /** Injected so tests do not sit through a real backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so the file says the same date every time it is tested. */
  now?: () => Date;
}

/** Summaries stay bounded no matter how popular the form: 5 pages of 200. */
const MAX_PAGES = 5;
const SUMMARY_PAGE_SIZE = 200;

/**
 * An export reads everything, so the cap is about protecting the server, not the form: 400 pages
 * of 1,000 is 400,000 responses. Past that the file says so instead of ending quietly.
 */
const EXPORT_PAGE_SIZE = 1_000;
const MAX_EXPORT_PAGES = 400;

const SITE_URL = 'intake.calder.click';

function questionKind(questionType: string | undefined): InsightQuestion['kind'] {
  if (questionType === 'multiple_choice' || questionType === 'dropdown' || questionType === 'checkboxes') return 'choice';
  if (questionType === 'scale' || questionType === 'rating') return 'scale';
  if (questionType === 'short_text' || questionType === 'long_text' || questionType === 'date' || questionType === 'time') return 'text';
  return 'other';
}

function isQuestion(item: unknown): item is GoogleFormItemResource & { questionId: string; title: string } {
  return !!item && typeof item === 'object' && 'kind' in item && (item as GoogleFormItemResource).kind === 'question'
    && typeof (item as GoogleFormItemResource).questionId === 'string'
    && typeof (item as GoogleFormItemResource).title === 'string';
}

/** A connection that has already passed the gate, so an access token is always present. */
type LiveConnection = Extract<AuthorizedConnection, { ok: true }>;

interface Access {
  user: SessionUser;
  form: PublicLibraryForm & { providerFormId: string };
  connection: LiveConnection;
}

export function createInsightsRouter(deps: InsightsRouterDeps): Router {
  const router = Router();
  const google = deps.googleClient ?? createGoogleFormsClient();
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep;

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  /**
   * The shared gate. Returns the caller's form and Google connection, or writes the response and
   * returns null. Both routes call it, in this order, so neither can drift from the other.
   */
  async function authorize(req: Request, res: Response, scope: AbuseScope): Promise<Access | null> {
    const user = await deps.getSession(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: 'You are not signed in. Sign in, then try again.' });
      return null;
    }

    if (deps.abuseLimiter) {
      try {
        const decision = await consumeRequestLimit(deps.abuseLimiter, scope, user.id, req);
        if (!decision.ok) {
          if (decision.reason === 'rate_limited') setRateLimitHeaders(res, decision.retryAfterSeconds);
          res.status(decision.reason === 'rate_limited' ? 429 : 503).json({ error: 'Too many requests. Wait briefly and try again.' });
          return null;
        }
      } catch {
        res.status(503).json({ error: 'Response reading is temporarily unavailable.' });
        return null;
      }
    }

    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const found = await deps.getForm(user.id, id).catch(() => null);
    // One shape for missing, foreign, non-Google, and unfinished forms alike:
    // existence and ownership are never distinguishable from outside.
    if (!found || !found.ok || found.form.provider !== 'google' || found.form.status !== 'created' || !found.form.providerFormId) {
      res.status(404).json({ error: 'Form not found.' });
      return null;
    }
    const form = found.form as PublicLibraryForm & { providerFormId: string };

    const entitlement = await deps.entitlement(user.id).catch(() => null);
    if (!entitlement || !isProActive(entitlement)) {
      res.status(403).json({ error: 'Response insights need Pro.', code: 'pro_required' });
      return null;
    }

    const connection = await deps.getConnection(user.id, 'google').catch(() => null);
    if (!connection || connection.ok !== true) {
      res.status(403).json({ error: 'Reconnect Google Forms first.', code: 'reauthorization_required' });
      return null;
    }
    // No response scope, no response data — not a partial read, not an empty file, nothing.
    if (!hasScope(connection.scopes, FORMS_RESPONSES_READONLY_SCOPE)) {
      res.status(403).json({ error: 'Enable response reading first.', code: 'responses_scope_required' });
      return null;
    }

    return { user, form, connection };
  }

  /** Google's own failures, turned into something a person can act on. */
  function googleFailure(res: Response, error: unknown): void {
    const info = error instanceof GoogleFormsApiError ? error.info : null;
    if (info && (info.httpStatus === 401 || info.httpStatus === 403)) {
      res.status(403).json({ error: 'Google refused the request. Reconnect Google Forms.', code: 'reauthorization_required' });
      return;
    }
    res.status(502).json({ error: 'Google did not answer. Try again shortly.' });
  }

  router.get('/:id/insights', async (req, res) => {
    const access = await authorize(req, res, 'forms.provider_read');
    if (!access) return;
    const { form, connection } = access;

    try {
      const resource = await google.getForm(connection.accessToken, form.providerFormId);
      const questions: InsightQuestion[] = (resource.items ?? [])
        .filter(isQuestion)
        .map(item => ({
          id: item.questionId,
          title: item.title,
          kind: questionKind(item.questionType),
          options: item.options?.map(option => option.value).filter(Boolean) as string[],
        }));

      const allAnswers: Array<Record<string, string[]>> = [];
      let pageToken: string | undefined;
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await google.listResponses(connection.accessToken, form.providerFormId, { pageSize: SUMMARY_PAGE_SIZE, pageToken });
        allAnswers.push(...batch.responses.map(response => response.answers));
        pageToken = batch.nextPageToken ?? undefined;
        if (!pageToken) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      const summary: FormInsights = summarizeResponses(questions, allAnswers);
      summary.truncated = truncated;
      return res.json({ status: 'ready', formId: form.id, title: form.title, insights: summary });
    } catch (error) {
      return googleFailure(res, error);
    }
  });

  /**
   * The export.
   *
   * The first page is fetched *before* any header is sent, so every failure a person can actually
   * fix — signed out, not Pro, no permission, Google refusing, Google down — still arrives as a
   * normal JSON error with a real status code. Once the file has started, a later failure is
   * written into the file as an explicit line rather than leaving a file that looks complete.
   *
   * Rows are written as pages arrive, so memory holds one page, not every answer. Response ids are
   * remembered in a Set so a page token that hands back a row twice cannot duplicate it.
   */
  router.get('/:id/insights/export.csv', async (req, res) => {
    const access = await authorize(req, res, 'forms.export');
    if (!access) return;
    const { form, connection } = access;
    const token = connection.accessToken;
    const formId = form.providerFormId;

    // These are the only knobs, both states of one documented filter. Nothing from the query
    // string is forwarded to Google: an unknown parameter is simply not read.
    const since = readSince(req);
    if (since === 'invalid') {
      return res.status(400).json({ error: 'The "since" date must be an ISO 8601 timestamp, like 2026-01-01T00:00:00Z.', code: 'invalid_since' });
    }
    const sinceExclusive = req.query.since_exclusive === '1' || req.query.since_exclusive === 'true';

    let questions: ExportQuestion[];
    let firstPage: Awaited<ReturnType<GoogleFormsClient['listResponses']>>;
    try {
      const [resource, page] = await Promise.all([
        google.getForm(token, formId),
        fetchPage(token, formId, { since, sinceExclusive }),
      ]);
      questions = (resource.items ?? []).filter(isQuestion).map(item => ({ id: item.questionId, title: item.title }));
      firstPage = page;
    } catch (error) {
      // Nothing has been written yet, so this is still an ordinary error response.
      return googleFailure(res, error);
    }

    if (firstPage.responses.length === 0 && !firstPage.nextPageToken) {
      // An empty form gets an answer, not a one-line file that looks like an export that worked.
      return res.status(404).json({
        error: since
          ? 'No responses match that date. Try an earlier date, or export everything.'
          : 'This form has no responses yet. Share it and responses will show up here.',
        code: 'no_responses',
      });
    }

    const exportedAt = now();
    const filename = csvFilename(exportedAt);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A browser download has no reason to read this as anything but a file.
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const write = async (chunk: string): Promise<boolean> => {
      if (res.writableEnded || res.destroyed) return false;
      if (res.write(chunk)) return true;
      // Backpressure: a slow reader should slow the paging, not buffer the whole form.
      return new Promise<boolean>(resolve => res.once('drain', () => resolve(!res.destroyed)));
    };

    let finished = false;
    let incomplete = false;
    try {
      await write(csvPreamble({ formTitle: form.title, questions, responses: [], exportedAt, siteUrl: SITE_URL }));

      const seen = new Set<string>();
      let written = 0;
      let page = firstPage;
      let pageToken = firstPage.nextPageToken ?? null;
      let pages = 1;

      for (;;) {
        for (const response of page.responses) {
          // A token should never repeat a response, but a duplicate row in someone's file is a real
          // data bug, so it is checked rather than assumed.
          if (seen.has(response.responseId)) continue;
          seen.add(response.responseId);
          // eslint-disable-next-line no-await-in-loop
          const more = await write(csvResponseLine(questions, response));
          if (!more) return; // the reader went away; stop spending quota
          written += 1;
        }
        if (!pageToken) break;
        if (pages >= MAX_EXPORT_PAGES) {
          await write(`# STOPPED: this export reached the ${MAX_EXPORT_PAGES * EXPORT_PAGE_SIZE} response limit. The file is incomplete.\r\n`);
          incomplete = true;
          break;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          page = await fetchPage(token, formId, { since, sinceExclusive, pageToken });
        } catch (error) {
          // Mid-file. The status line is long gone, so say it in the file, plainly.
          const info = error instanceof GoogleFormsApiError ? error.info : null;
          const reason = info && (info.httpStatus === 401 || info.httpStatus === 403)
            ? 'Google stopped accepting the connection. Reconnect Google Forms, then export again.'
            : 'Google did not answer. Export again in a few minutes.';
          await write(`# INCOMPLETE: ${written} responses were written before this happened. ${reason}\r\n`);
          incomplete = true;
          break;
        }
        pageToken = page.nextPageToken ?? null;
        pages += 1;
      }

      // A file that stopped early never gets the line that would let it pass for complete.
      if (!incomplete) await write(`# End of export. ${written} ${written === 1 ? 'response' : 'responses'} written.\r\n`);
      finished = true;
    } finally {
      if (!finished) res.destroy();
      else res.end();
    }
  });

  /** One page of responses, retried only where retrying can help. */
  function fetchPage(
    accessToken: string,
    formId: string,
    query: { since?: string; sinceExclusive?: boolean; pageToken?: string },
  ) {
    return withRetry(
      () => google.listResponses(accessToken, formId, {
        pageSize: EXPORT_PAGE_SIZE,
        pageToken: query.pageToken,
        since: query.since,
        sinceExclusive: query.sinceExclusive,
      }),
      sleep ? { sleep } : {},
    );
  }

  return router;
}

/** `since` is read, validated, and passed on as a timestamp — never as a raw filter string. */
function readSince(req: Request): string | undefined | 'invalid' {
  const raw = req.query.since;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return 'invalid';
  // Accept a date as a reader would type it, then pin it to UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'invalid';
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'invalid';
}
