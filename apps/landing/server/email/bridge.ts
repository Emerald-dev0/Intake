/**
 * The one-way seam between Better Auth and the email stack.
 *
 * `server/auth.ts` is imported by migration tooling and constructs Better Auth at module load, so it
 * cannot import the email runtime (which needs the pool that auth.ts itself creates). Instead auth.ts
 * calls through these optional hooks; `server/index.ts` installs them once the runtime exists.
 *
 * Every hook is best-effort: an email failure must never break a sign-in, a password reset or an
 * account link. Callers here swallow and log.
 */

export interface AuthEmailHooks {
  /** Sends the reset email. Better Auth generated, stored and expires the token. */
  sendPasswordReset(input: { userId: string; email: string; name: string | null; token: string }): Promise<void>;
  /** Called after a successful password reset. */
  onPasswordReset(userId: string): Promise<void>;
  /** Called after every new session. `networkSubject` is already derived from the trusted proxy. */
  onNewSession(input: { userId: string; networkSubject: string }): Promise<void>;
  /** Called when a Google sign-in account row is linked or unlinked. */
  onAccountLinked(input: { userId: string; providerId: string }): Promise<void>;
  onAccountUnlinked(input: { userId: string; providerId: string }): Promise<void>;
}

let hooks: AuthEmailHooks | null = null;

export function setAuthEmailHooks(next: AuthEmailHooks): void {
  hooks = next;
}

/** Clears the bridge. Tests use this to prove the auth flow works with no email runtime at all. */
export function clearAuthEmailHooks(): void {
  hooks = null;
}

export function authEmailHooks(): AuthEmailHooks | null {
  return hooks;
}

/** Never throws: authentication must not depend on email infrastructure being healthy. */
export async function safeHook<T>(name: keyof AuthEmailHooks, run: (hooks: AuthEmailHooks) => Promise<T>): Promise<void> {
  const current = hooks;
  if (!current) return;
  try {
    await run(current);
  } catch (error) {
    console.warn(JSON.stringify({
      time: new Date().toISOString(),
      level: 'warn',
      event: 'email.hook.failed',
      hook: String(name),
      error: error instanceof Error ? error.message : 'unknown',
    }));
  }
}
