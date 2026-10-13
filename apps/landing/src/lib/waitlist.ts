/** Browser-safe wait-list contract. No database, provider, or server imports. */
export function normalizeWaitlistEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isWaitlistEmail(value: string): boolean {
  if (value.length > 254 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && /^[a-z]{2,63}$/i.test(labels.at(-1) ?? '') &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export class WaitlistError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'WaitlistError';
  }
}

/** A lost response is safe to retry: the API deduplicates both the address and welcome event. */
export async function joinWaitlist(email: string, website = '', signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: normalizeWaitlistEmail(email), website }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = response.status === 400 ? 'Please enter a valid email address.'
        : response.status === 429 ? 'A few too many attempts. Please wait a little, then try again.'
        : 'We couldn’t save your place right now. Please try again in a moment.';
      throw new WaitlistError(message, response.status);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'joined') {
      throw new WaitlistError('We couldn’t confirm your signup. Please try again — you won’t be added twice.');
    }
  } catch (error) {
    if (error instanceof WaitlistError) throw error;
    throw new WaitlistError('We couldn’t reach Intake. Check your connection and try again — you won’t be added twice.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
