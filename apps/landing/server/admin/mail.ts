/**
 * Admin-composed mail: the server half of "write a note, choose who gets it, look at it, send it".
 *
 * Three properties are deliberate, and each one exists because the alternative is a lie:
 *
 *  - **One message per recipient.** Every person gets their own `email_delivery` row and their own
 *    idempotency key (`intake:admin-message:<previewId>:<userId>`). A partial failure is therefore
 *    visible per person instead of disappearing inside a single "sent" count.
 *  - **The browser never decides who is eligible.** It sends a selection — a named segment or a list
 *    of user ids — and the server resolves it, counts it, and refuses anything above
 *    `MAIL_RECIPIENT_CAP`. The cap is server-owned so the UI cannot argue with it.
 *  - **Preview and send render through the same call.** `renderEmail('admin_message', …)` produces
 *    the preview bytes and the delivered bytes, so what the admin approved is what is sent.
 *
 * Nothing here stores the body of a sent message: the copy is already in each recipient's mailbox,
 * and an archive of personal correspondence in the admin database would be a liability, not a feature.
 */

import { randomUUID } from 'node:crypto';
import type { EmailConfig } from '../email/config';
import { maskEmail, type EmailSendOutcome, type SendEmailRequest } from '../email/types';
import { baseVariables } from '../email/service';
import { renderEmail } from '../email/templates';
import type { EmailVariables } from '../email/templates';

/** Server-owned ceiling for a single send. Shown in the UI before anyone confirms anything. */
export const MAIL_RECIPIENT_CAP = 100;
export const MAIL_SUBJECT_MAX = 140;
export const MAIL_HEADING_MAX = 140;
export const MAIL_BODY_MAX = 6000;
export const MAIL_BUTTON_LABEL_MAX = 40;

/** The only substitutions the composer understands. Unknown tokens are rejected, not silently kept. */
export const MAIL_TOKENS = ['name', 'email'] as const;
export type MailToken = typeof MAIL_TOKENS[number];

export type MailSegment = 'all' | 'verified' | 'unverified';
export const MAIL_SEGMENTS: readonly MailSegment[] = ['all', 'verified', 'unverified'];

export const SEGMENT_LABEL: Record<MailSegment, string> = {
  all: 'every account',
  verified: 'accounts with a verified address',
  unverified: 'accounts whose address is not verified yet',
};

export interface MailRecipient {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  createdAt: string | null;
}

export type MailSelection =
  | { kind: 'segment'; segment: MailSegment }
  | { kind: 'ids'; ids: string[] };

/**
 * Who the operator is writing as.
 *
 * The product decides the sender for everything it sends on its own. A hand-written note is
 * different: it is either the team speaking or Daniel speaking, and that choice belongs to the person
 * writing it. `system` stays available because a billing or account note should not pretend to be
 * personal.
 */
export type MailSender = 'system' | 'team' | 'personal';
export const MAIL_SENDERS: readonly MailSender[] = ['system', 'team', 'personal'];
export const SENDER_LABEL: Record<MailSender, string> = {
  system: 'Intake (product address)',
  team: 'The Intake Team',
  personal: 'Daniel, personally',
};

export interface ComposeDraft {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  /** Absolute https URL, or a path starting with `/` that is resolved against the app origin. */
  buttonUrl: string;
  /** Defaults to `system`: an operator who does not think about this gets the neutral identity. */
  sender?: MailSender;
}

export type DraftField = keyof ComposeDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

export interface MailSendRecord {
  id: string;
  adminUserId: string | null;
  subject: string;
  selectionKind: MailSelection['kind'];
  selectionLabel: string;
  recipients: number;
  sent: number;
  skipped: number;
  failed: number;
  createdAt: string;
}

/** Storage seam. A postgres implementation lives in `mail-postgres.ts`; tests use a fake. */
export interface MailStore {
  /**
   * True when the send log table exists. Sending is refused when it does not, because a message that
   * goes out with no record of who sent it or what it said is worse than a closed composer.
   */
  ready(): Promise<boolean>;
  /** Total matching the selection, ignoring the cap. */
  count(selection: MailSelection): Promise<number>;
  /** Up to `limit` recipients, in a stable order so the confirmed count matches the sent set. */
  resolve(selection: MailSelection, limit: number): Promise<MailRecipient[]>;
  /** Browsing the directory for the picker. `segment` narrows the list; it does not imply a send. */
  search(input: { query: string; segment: MailSegment | null; limit: number; offset: number }): Promise<{ items: MailRecipient[]; total: number }>;
  record(record: MailSendRecord): Promise<void>;
  recent(limit: number): Promise<MailSendRecord[]>;
}

export interface MailPreview {
  previewId: string;
  subject: string;
  html: string;
  text: string;
  /** What the sample was rendered with, so the UI can be explicit about whose name is in it. */
  sample: { name: string; email: string };
  recipients: { total: number; cap: number; overCap: boolean; segmentLabel: string };
  /** False when the send log table is missing: the composer will refuse to send. */
  ready: boolean;
  tokens: string[];
}

export interface MailSendResult {
  sendId: string;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  results: Array<{ userId: string; name: string; email: string; status: EmailSendOutcome['status']; errorCode: string | null }>;
}

export class MailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MailError';
  }
}

// ── Draft validation ─────────────────────────────────────────────────────────────────────────────

const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function firstUnknownToken(text: string): string | null {
  for (const match of text.matchAll(TOKEN)) {
    if (!(MAIL_TOKENS as readonly string[]).includes(match[1].toLowerCase())) return match[1];
  }
  return null;
}

function fieldText(raw: Record<string, unknown>, name: string): string | null {
  const value = raw[name];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || CONTROL.test(value)) return null;
  return value;
}

/**
 * Validates and normalizes a composed draft. Pure, so the same rules run on preview and on send:
 * a draft that previewed cleanly cannot be sent under different rules.
 */
export function parseComposeDraft(raw: unknown, appOrigin: string):
  | { ok: true; draft: ComposeDraft }
  | { ok: false; errors: DraftErrors; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: {}, message: 'The message could not be read.' };
  }
  const input = raw as Record<string, unknown>;
  const errors: DraftErrors = {};

  const subject = fieldText(input, 'subject');
  const heading = fieldText(input, 'heading');
  const body = fieldText(input, 'body');
  const buttonLabel = fieldText(input, 'buttonLabel');
  const buttonUrl = fieldText(input, 'buttonUrl');
  // Unknown senders are refused rather than defaulted: an operator who picked Daniel and got the
  // system address would have sent the wrong letter without noticing.
  const senderField = typeof input.sender === 'string' ? input.sender.trim() : '';
  const sender = MAIL_SENDERS.includes(senderField as MailSender) ? senderField as MailSender : 'system';
  if (senderField && !MAIL_SENDERS.includes(senderField as MailSender)) {
    errors.sender = 'Choose one of the available senders.';
  }
  if (subject === null) errors.subject = 'The subject contains characters that cannot be sent.';
  if (heading === null) errors.heading = 'The heading contains characters that cannot be sent.';
  if (body === null) errors.body = 'The message contains characters that cannot be sent.';
  if (buttonLabel === null) errors.buttonLabel = 'The button label contains characters that cannot be sent.';
  if (buttonUrl === null) errors.buttonUrl = 'The link contains characters that cannot be sent.';

  const trimmed = {
    subject: (subject ?? '').trim(),
    heading: (heading ?? '').trim(),
    body: (body ?? '').trim(),
    buttonLabel: (buttonLabel ?? '').trim(),
    buttonUrl: (buttonUrl ?? '').trim(),
  };

  if (!errors.subject) {
    if (trimmed.subject.length < 1) errors.subject = 'Every message needs a subject.';
    else if (trimmed.subject.length > MAIL_SUBJECT_MAX) errors.subject = `Keep the subject under ${MAIL_SUBJECT_MAX} characters.`;
    else if (/[\r\n]/.test(trimmed.subject)) errors.subject = 'A subject is one line.';
  }
  if (!errors.heading && trimmed.heading.length > MAIL_HEADING_MAX) {
    errors.heading = `Keep the heading under ${MAIL_HEADING_MAX} characters.`;
  }
  if (!errors.body) {
    if (trimmed.body.length < 1) errors.body = 'Write the message before sending it.';
    else if (trimmed.body.length > MAIL_BODY_MAX) errors.body = `Keep the message under ${MAIL_BODY_MAX} characters.`;
  }
  if (!errors.buttonLabel && trimmed.buttonLabel.length > MAIL_BUTTON_LABEL_MAX) {
    errors.buttonLabel = `Keep the button label under ${MAIL_BUTTON_LABEL_MAX} characters.`;
  }

  // A button needs a destination, and the destination must be somewhere on the Intake origin.
  // Any other scheme (javascript:, data:, mailto: to a stranger) is refused rather than sanitized.
  let resolvedUrl = '';
  if (!errors.buttonUrl) {
    if (!trimmed.buttonUrl) {
      if (trimmed.buttonLabel) errors.buttonUrl = 'A button needs a destination.';
    } else if (trimmed.buttonUrl.startsWith('/')) {
      if (trimmed.buttonUrl.startsWith('//')) errors.buttonUrl = 'Use a single leading slash.';
      else resolvedUrl = `${appOrigin.replace(/\/$/, '')}${trimmed.buttonUrl}`;
    } else {
      try {
        const url = new URL(trimmed.buttonUrl);
        if (url.protocol !== 'https:') errors.buttonUrl = 'Links must use https.';
        else resolvedUrl = url.toString();
      } catch {
        errors.buttonUrl = 'Use a full https:// link, or a path starting with /.';
      }
    }
  }

  for (const [field, value] of Object.entries(trimmed)) {
    if (!value || errors[field as DraftField]) continue;
    const unknown = firstUnknownToken(value);
    if (unknown) {
      errors[field as DraftField] = `Unknown placeholder {{${unknown}}}. Use {{name}} or {{email}}.`;
    }
  }

  const first = Object.keys(errors)[0] as DraftField | undefined;
  if (first) {
    return { ok: false, errors, message: errors[first] ?? 'The message could not be read.' };
  }

  return {
    ok: true,
    draft: {
      sender,
      subject: trimmed.subject,
      heading: trimmed.heading,
      body: trimmed.body,
      buttonLabel: trimmed.buttonLabel,
      buttonUrl: resolvedUrl,
    },
  };
}

function absoluteLink(value: string, origin: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return `${origin.replace(/\/$/, '')}${trimmed}`;
  return trimmed;
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** `{{name}}` becomes a first name (or nothing), `{{email}}` the recipient's address. */
export function personalize(text: string, recipient: Pick<MailRecipient, 'name' | 'email'>): string {
  return text.replace(TOKEN, (_match, token: string) => {
    const key = token.toLowerCase();
    if (key === 'name') return firstNameOf(recipient.name);
    if (key === 'email') return recipient.email;
    return '';
  });
}

export function tokensIn(draft: ComposeDraft): string[] {
  const found = new Set<string>();
  for (const value of Object.values(draft)) {
    for (const match of value.matchAll(TOKEN)) found.add(match[1].toLowerCase());
  }
  return [...found].sort();
}

/**
 * The per-recipient variables for one composed message. Kept in one place so the preview, the send
 * and any future retry cannot drift apart.
 */
export function composeVariables(
  draft: ComposeDraft,
  recipient: Pick<MailRecipient, 'name' | 'email'>,
  config: EmailConfig,
  at: Date,
): EmailVariables {
  return {
    ...baseVariables(config, at),
    userName: firstNameOf(recipient.name) || 'there',
    adminSubject: personalize(draft.subject, recipient),
    adminHeading: personalize(draft.heading || draft.subject, recipient),
    adminBody: personalize(draft.body, recipient),
    adminButtonLabel: personalize(draft.buttonLabel || 'Open Intake', recipient),
    // The template only renders a button when this is present, so an operator who leaves the link
    // empty gets a plain letter. Relative paths are resolved here as well as in validation, so a
    // caller that skips `parseComposeDraft` still cannot ship a relative href into an inbox.
    dashboardUrl: absoluteLink(draft.buttonUrl, config.appOrigin),
  };
}

/** Selection parsing shared by the routes and the service. */
export function parseSelection(raw: unknown): MailSelection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.kind === 'segment') {
    return MAIL_SEGMENTS.includes(input.segment as MailSegment) ? { kind: 'segment', segment: input.segment as MailSegment } : null;
  }
  if (input.kind === 'ids') {
    if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > MAIL_RECIPIENT_CAP * 4) return null;
    const ids = [...new Set(input.ids)];
    if (ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 255 || /[\u0000-\u001f\u007f]/.test(id))) return null;
    return { kind: 'ids', ids: ids as string[] };
  }
  return null;
}

export function selectionLabel(selection: MailSelection): string {
  return selection.kind === 'segment'
    ? SEGMENT_LABEL[selection.segment]
    : `${selection.ids.length} chosen account${selection.ids.length === 1 ? '' : 's'}`;
}

export interface MailServiceOptions {
  store: MailStore;
  config: EmailConfig;
  send: (request: SendEmailRequest) => Promise<EmailSendOutcome>;
  now?: () => Date;
  log?: (label: string, detail?: Record<string, unknown>) => void;
  /** Parallel deliveries. Bounded so one send cannot exhaust sockets or a provider's burst limit. */
  concurrency?: number;
}

export interface MailService {
  /** The origin links are resolved against. Exposed so route-level validation uses the same value. */
  readonly appOrigin: string;
  /** Whether the send log exists. The dashboard disables sending when it does not. */
  ready(): Promise<boolean>;
  search(input: { query: string; segment: MailSegment | null; page: number; limit: number }): Promise<{ items: MailRecipient[]; total: number; page: number; pageSize: number; totalPages: number }>;
  preview(input: { draft: ComposeDraft; selection: MailSelection; previewId?: string }): Promise<MailPreview>;
  send(input: { draft: ComposeDraft; selection: MailSelection; previewId: string; confirmedRecipients: number; adminUserId: string }): Promise<MailSendResult>;
  recent(limit: number): Promise<MailSendRecord[]>;
}

export function createMailService(options: MailServiceOptions): MailService {
  const { store, config, send } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));

  async function resolve(selection: MailSelection) {
    const total = await store.count(selection);
    const recipients = total === 0 ? [] : await store.resolve(selection, Math.min(total, MAIL_RECIPIENT_CAP + 1));
    return { total, recipients };
  }

  return {
    appOrigin: config.appOrigin,

    ready() {
      return store.ready().catch(() => false);
    },

    async search(input) {
      const { items, total } = await store.search({
        query: input.query, segment: input.segment, limit: input.limit, offset: (input.page - 1) * input.limit,
      });
      return {
        items,
        total,
        page: input.page,
        pageSize: input.limit,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      };
    },

    async preview({ draft, selection, previewId }) {
      const { total, recipients } = await resolve(selection);
      const sample = recipients[0] ?? { id: '', name: '', email: '', verified: false, createdAt: null };
      const at = now();
      let rendered;
      try {
        rendered = renderEmail('admin_message', composeVariables(draft, sample, config, at));
      } catch {
        throw new MailError(422, 'template_error', 'The message could not be rendered.');
      }
      return {
        previewId: previewId ?? randomUUID(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        sample: {
          name: sample.name ? firstNameOf(sample.name) : 'there',
          // The preview is admin-only, but a full address in a response body is still unnecessary:
          // the sample line only needs to show that the placeholder resolved.
          email: sample.email ? maskEmail(sample.email) : 'you@example.com',
        },
        recipients: { total, cap: MAIL_RECIPIENT_CAP, overCap: total > MAIL_RECIPIENT_CAP, segmentLabel: selectionLabel(selection) },
        ready: await store.ready().catch(() => false),
        tokens: tokensIn(draft),
      };
    },

    async send({ draft, selection, previewId, confirmedRecipients, adminUserId }) {
      // Refuse before composing anything: an unrecorded send cannot be audited or reconciled.
      if (!await store.ready().catch(() => false)) {
        throw new MailError(503, 'mail_unavailable', 'The send log is not installed. Apply migration 020_admin_mail.sql before sending.');
      }
      const { total, recipients } = await resolve(selection);
      if (total > MAIL_RECIPIENT_CAP) {
        throw new MailError(400, 'recipient_cap', `One send is limited to ${MAIL_RECIPIENT_CAP} people.`, {
          cap: MAIL_RECIPIENT_CAP, total,
        });
      }
      if (total === 0) throw new MailError(400, 'no_recipients', 'That selection matches no accounts.');
      if (!Number.isSafeInteger(confirmedRecipients) || confirmedRecipients !== total) {
        // Someone joined or left between the preview and the confirmation. Refuse rather than send
        // to a set the admin never approved.
        throw new MailError(409, 'recipient_count_changed', 'The number of recipients changed. Preview again before sending.', { total });
      }

      const at = now();
      const results: MailSendResult['results'] = [];
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      let cursor = 0;
      async function worker() {
        while (cursor < recipients.length) {
          const recipient = recipients[cursor++];
          const request: SendEmailRequest = {
            type: 'admin_message',
            sender: draft.sender ?? 'system',
            to: recipient.email,
            eventId: `${previewId}:${recipient.id}`,
            userId: recipient.id,
            variables: Object.fromEntries(
              Object.entries(composeVariables(draft, recipient, config, at)).map(([key, value]) => [key, String(value ?? '')]),
            ),
            tags: [{ name: 'campaign', value: previewId }],
          };
          let outcome: EmailSendOutcome;
          try {
            outcome = await send(request);
          } catch {
            outcome = { status: 'failed', deliveryId: '', errorCode: 'email_internal_error', retryable: true };
          }
          if (outcome.status === 'sent') sent += 1;
          else if (outcome.status === 'skipped') skipped += 1;
          else failed += 1;
          results.push({
            userId: recipient.id,
            name: recipient.name,
            email: maskEmail(recipient.email),
            status: outcome.status,
            errorCode: outcome.status === 'failed' ? outcome.errorCode : null,
          });
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, recipients.length) }, () => worker()));

      const record: MailSendRecord = {
        id: previewId,
        adminUserId,
        subject: draft.subject.slice(0, 200),
        selectionKind: selection.kind,
        selectionLabel: selectionLabel(selection).slice(0, 120),
        recipients: total,
        sent,
        skipped,
        failed,
        createdAt: at.toISOString(),
      };
      // A logging failure must not turn a completed send into a 500: the deliveries already exist.
      await store.record(record).catch(() => log('admin.mail.record_failed', { sendId: previewId }));

      log('admin.mail.sent', { sendId: previewId, total, sent, skipped, failed });
      results.sort((a, b) => a.userId.localeCompare(b.userId));
      return { sendId: previewId, total, sent, skipped, failed, results };
    },

    async recent(limit) {
      return store.recent(limit);
    },
  };
}
