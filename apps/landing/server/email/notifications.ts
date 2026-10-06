import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { EmailLogger } from './logging';
import { createEmailLogger } from './logging';
import type { EmailService } from './service';
import type { EmailType } from './types';

/**
 * The event layer: named, typed things that happened in Intake.
 *
 * Callers say "passwordChanged(userId)". They never build a subject line, choose a template or know
 * that Calder exists. Adding a future event means adding one method here plus one template — the
 * provider adapter never changes (mission §13).
 *
 * Every event id is deterministic (`welcome:{userId}`, `security-password-changed:{eventId}`), so a
 * retry after a network failure can never deliver the same notice twice (mission §8).
 */

export interface EmailUser {
  id: string;
  name: string | null;
  email: string;
}

export interface UserDirectory {
  getById(userId: string): Promise<EmailUser | null>;
}

/** Returns true when this sign-in looks new for the user (bounded to one notice per 24h). */
export interface SignInMarkers {
  observe(userId: string, networkSubject: string): Promise<boolean>;
}

export interface EmailNotifier {
  welcome(userId: string): Promise<void>;
  passwordChanged(userId: string): Promise<void>;
  emailChanged(userId: string, previousEmail: string, newEmail: string): Promise<void>;
  googleConnected(userId: string): Promise<void>;
  googleDisconnected(userId: string): Promise<void>;
  providerConnected(userId: string, providerName: string, accountLabel: string): Promise<void>;
  providerDisconnected(userId: string, providerName: string, accountLabel: string): Promise<void>;
  creditsLow(userId: string, remaining: number, resetAt: Date | string): Promise<void>;
  /** Returns true when an email was sent. Callers decide what a new sign-in means. */
  newSignIn(userId: string, networkSubject: string): Promise<boolean>;
  // Billing events
  subscriptionStarted(userId: string, data: { planLabel: string; interval: string; amount: string; subscriptionCredits: string; dailyCredits: string; periodStart: string; periodEnd: string }): Promise<void>;
  subscriptionRenewed(userId: string, data: { amount: string; periodStart: string; periodEnd: string; subscriptionCredits: string }): Promise<void>;
  subscriptionCanceled(userId: string, data: { canceledAt: string }): Promise<void>;
  subscriptionEnding(userId: string, data: { periodEnd: string }): Promise<void>;
  subscriptionEnded(userId: string): Promise<void>;
  paymentSuccess(userId: string, data: { amount: string; description: string; timestamp: string; referenceId: string }): Promise<void>;
  paymentFailed(userId: string, data: { description: string; timestamp: string }): Promise<void>;
  creditPackPurchased(userId: string, data: { packLabel: string; credits: string; amount: string; timestamp: string }): Promise<void>;
  renewalReminder(userId: string, data: { renewalDate: string; amount: string; planLabel: string }): Promise<void>;
}

export interface NotifierOptions {
  emails: EmailService;
  users: UserDirectory;
  markers: SignInMarkers;
  now?: () => Date;
  newId?: () => string;
  log?: EmailLogger;
}

const PROVIDER_LABELS: Record<string, string> = { google: 'Google Forms', microsoft: 'Microsoft Forms' };

export function createEmailNotifier(options: NotifierOptions): EmailNotifier {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `ev_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  const log = options.log ?? createEmailLogger();

  /** One send helper so every event is logged, typed and idempotent. */
  async function emit(
    type: EmailType,
    eventId: string,
    user: EmailUser,
    variables: Record<string, string>,
  ): Promise<boolean> {
    const outcome = await options.emails.send({ type, to: user.email, eventId, userId: user.id, variables });
    if (outcome.status !== 'sent') {
      log('email.send.skipped', { emailType: type, eventId, userId: user.id, reason: outcome.status === 'skipped' ? outcome.reason : outcome.errorCode });
      return false;
    }
    return true;
  }

  async function welcome(userId: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    // Idempotent on the user: verifying twice can never produce two welcome emails.
    await emit('welcome', `welcome:${userId}`, user, { userName: user.name ?? '' });
  }

  async function passwordChanged(userId: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('security_password_changed', `security-password-changed:${newId()}`, user, { userName: user.name ?? '' });
  }

  async function emailChanged(userId: string, previousEmail: string, newEmail: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    const eventId = `security-email-changed:${newId()}`;
    // Notified at both addresses: the old one is the "was this you?" channel, the new one confirms.
    await options.emails.send({
      type: 'security_email_changed', to: previousEmail, eventId: `${eventId}:old`, userId: userId,
      variables: { userName: user.name ?? '', previousEmail, newEmail },
    });
    await options.emails.send({
      type: 'security_email_changed', to: newEmail, eventId: `${eventId}:new`, userId: userId,
      variables: { userName: user.name ?? '', previousEmail, newEmail },
    });
  }

  async function googleConnected(userId: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('security_google_connected', `security-google-connected:${newId()}`, user, { userName: user.name ?? '' });
  }

  async function googleDisconnected(userId: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('security_google_disconnected', `security-google-disconnected:${newId()}`, user, { userName: user.name ?? '' });
  }

  async function providerConnected(userId: string, providerName: string, accountLabel: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('provider_connection_added', `provider-connected:${newId()}`, user, {
      userName: user.name ?? '',
      providerName: PROVIDER_LABELS[providerName] ?? providerName,
      accountLabel,
    });
  }

  async function providerDisconnected(userId: string, providerName: string, accountLabel: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('provider_connection_removed', `provider-disconnected:${newId()}`, user, {
      userName: user.name ?? '',
      providerName: PROVIDER_LABELS[providerName] ?? providerName,
      accountLabel,
    });
  }

  async function creditsLow(userId: string, remaining: number, resetAt: Date | string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    // Keyed on the user and the UTC day: at most one low-credit notice per day.
    const day = now().toISOString().slice(0, 10);
    await emit('credits_low', `credits-low:${userId}:${day}`, user, {
      userName: user.name ?? '',
      remaining: String(remaining),
      resetAt: typeof resetAt === 'string' ? resetAt : resetAt.toISOString(),
    });
  }

  async function newSignIn(userId: string, networkSubject: string): Promise<boolean> {
    const isNew = await options.markers.observe(userId, networkSubject);
    if (!isNew) return false;
    const user = await options.users.getById(userId);
    if (!user) return false;
    return emit('security_new_sign_in', `security-new-sign-in:${userId}:${now().toISOString().slice(0, 10)}`, user, {
      userName: user.name ?? '',
      method: 'Intake',
    });
  }

  // ── Billing notifications ──────────────────────────────────────────────────────────────────

  async function subscriptionStarted(userId: string, data: { planLabel: string; interval: string; amount: string; subscriptionCredits: string; dailyCredits: string; periodStart: string; periodEnd: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_subscription_started', `billing-sub-started:${userId}:${data.periodStart}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function subscriptionRenewed(userId: string, data: { amount: string; periodStart: string; periodEnd: string; subscriptionCredits: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_subscription_renewed', `billing-sub-renewed:${userId}:${data.periodStart}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function subscriptionCanceled(userId: string, data: { canceledAt: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_subscription_canceled', `billing-sub-canceled:${userId}:${newId()}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function subscriptionEnding(userId: string, data: { periodEnd: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_subscription_ending', `billing-sub-ending:${userId}:${data.periodEnd}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function subscriptionEnded(userId: string): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_subscription_ended', `billing-sub-ended:${userId}:${newId()}`, user, {
      userName: user.name ?? '',
    });
  }

  async function paymentSuccess(userId: string, data: { amount: string; description: string; timestamp: string; referenceId: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_payment_success', `billing-payment:${data.referenceId}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function paymentFailed(userId: string, data: { description: string; timestamp: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_payment_failed', `billing-payment-failed:${userId}:${newId()}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function creditPackPurchased(userId: string, data: { packLabel: string; credits: string; amount: string; timestamp: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    await emit('billing_credit_pack_purchased', `billing-credit-pack:${userId}:${newId()}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  async function renewalReminder(userId: string, data: { renewalDate: string; amount: string; planLabel: string }): Promise<void> {
    const user = await options.users.getById(userId);
    if (!user) return;
    // Idempotent: one reminder per user per renewal date
    await emit('billing_renewal_reminder', `billing-renewal-reminder:${userId}:${data.renewalDate}`, user, {
      userName: user.name ?? '',
      ...data,
    });
  }

  return {
    welcome, passwordChanged, emailChanged, googleConnected, googleDisconnected,
    providerConnected, providerDisconnected, creditsLow, newSignIn,
    subscriptionStarted, subscriptionRenewed, subscriptionCanceled,
    subscriptionEnding, subscriptionEnded,
    paymentSuccess, paymentFailed,
    creditPackPurchased, renewalReminder,
  };
}

// ── User directory and sign-in markers ─────────────────────────────────────────────────────────

export function createPostgresUserDirectory(pool: Pool): UserDirectory {
  return {
    async getById(userId) {
      const result = await pool.query<{ id: string; name: string | null; email: string }>(
        'SELECT id, name, email FROM "user" WHERE id = $1 LIMIT 1',
        [userId],
      );
      return result.rows[0] ?? null;
    },
  };
}

const NEW_SIGN_IN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Remembers the network subject each account last signed in from.
 *
 * The first observation for an account is never emailed: that is the signup session, and a
 * "new sign-in" notice seconds after a welcome email is noise.
 */
export function createPostgresSignInMarkers(pool: Pool, hashKey: string): SignInMarkers {
  return {
    async observe(userId, networkSubject) {
      const hash = createHmac('sha256', hashKey).update(`intake-signin:v1:${userId}:${networkSubject}`).digest('hex');
      const result = await pool.query<{ network_hash: string; last_seen_at: Date }>(
        'SELECT network_hash, last_seen_at FROM user_sign_in_marker WHERE user_id = $1 LIMIT 1',
        [userId],
      );
      const row = result.rows[0];
      const at = new Date();
      if (!row) {
        await pool.query(
          `INSERT INTO user_sign_in_marker (user_id, network_hash, last_seen_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, hash, at],
        );
        return false;
      }
      const stale = at.getTime() - row.last_seen_at.getTime() > NEW_SIGN_IN_WINDOW_MS;
      const different = row.network_hash !== hash;
      await pool.query(
        'UPDATE user_sign_in_marker SET network_hash = $2, last_seen_at = $3 WHERE user_id = $1',
        [userId, hash, at],
      );
      return different && stale;
    },
  };
}

export function createMemorySignInMarkers(): SignInMarkers {
  const seen = new Map<string, { hash: string; at: number }>();
  return {
    async observe(userId, networkSubject) {
      const hash = createHmac('sha256', 'memory-signin-key').update(`${userId}:${networkSubject}`).digest('hex');
      const previous = seen.get(userId);
      const at = Date.now();
      if (!previous) {
        seen.set(userId, { hash, at });
        return false;
      }
      const isNew = previous.hash !== hash && at - previous.at > NEW_SIGN_IN_WINDOW_MS;
      seen.set(userId, { hash, at });
      return isNew;
    },
  };
}
