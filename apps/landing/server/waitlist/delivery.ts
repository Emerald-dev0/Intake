import type { EmailService } from '../email/service';
import type { EmailSendOutcome } from '../email/types';
import type { WaitlistStore, WelcomeUpdate } from './store';

export interface WaitlistDeliveryOptions {
  store: WaitlistStore;
  emails: EmailService;
  now?: () => Date;
  /** Event labels only; never recipients, payloads, or raw provider errors. */
  onError?: (label: string) => void;
}

/** At-least-once processing, with atomic SQL leases and a stable, provider-idempotent event id. */
export function createWaitlistDelivery(options: WaitlistDeliveryOptions) {
  const { store, emails } = options;
  const now = options.now ?? (() => new Date());
  const report = options.onError ?? (() => undefined);
  let active: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function deliver(id: string): Promise<void> {
    try {
      const claim = await store.claimWelcome(id);
      if (!claim) return;
      let outcome: EmailSendOutcome;
      try {
        outcome = await emails.send({
          type: 'waitlist_welcome', to: claim.email, eventId: `waitlist:${claim.id}`,
          variables: {}, tags: [{ name: 'source', value: 'waitlist' }],
        });
      } catch {
        // An unexpected failure still has a durable retry; it must never discard the signup.
        outcome = { status: 'failed', deliveryId: '', errorCode: 'email_internal_error', retryable: true };
      }
      const at = now();
      const update: WelcomeUpdate = { status: 'pending', nextAttemptAt: at, errorCode: null };
      if (outcome.status === 'sent') {
        update.status = 'accepted'; // Provider acceptance, NOT proof of inbox delivery.
      } else if (outcome.status === 'skipped' && outcome.reason === 'suppressed') {
        update.status = 'suppressed';
        update.errorCode = 'email_suppressed';
      } else if (outcome.status === 'skipped' && outcome.reason === 'duplicate') {
        update.status = 'accepted';
      } else if (outcome.status === 'skipped') {
        update.errorCode = 'email_provider_not_configured';
        update.nextAttemptAt = new Date(at.getTime() + 5 * 60_000);
      } else {
        update.status = outcome.errorCode === 'email_suppressed' ? 'suppressed' : outcome.retryable ? 'pending' : 'blocked';
        update.errorCode = outcome.errorCode;
        const delay = Math.min(60, 2 ** Math.min(6, claim.attempt - 1)) * 60_000;
        update.nextAttemptAt = new Date(at.getTime() + delay);
      }
      await store.finishWelcome(claim, update);
    } catch {
      // A failed finish leaves the lease recoverable; the same email event is retried, not remade.
      report('Wait-list welcome processing unavailable');
    }
  }

  function flush(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      const ids = await store.pendingIds(20);
      // Bound concurrency to protect the provider and database during backlog recovery.
      for (let index = 0; index < ids.length; index += 3) {
        if (stopped) break;
        await Promise.all(ids.slice(index, index + 3).map(deliver));
      }
    })().catch(() => report('Wait-list welcome queue unavailable')).finally(() => { active = null; });
    return active;
  }

  function start(): void {
    if (timer || stopped) return;
    void flush();
    timer = setInterval(() => { void flush(); }, 30_000);
    timer.unref?.();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    await active;
  }

  return { flush, start, stop };
}
