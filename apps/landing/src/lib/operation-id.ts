/**
 * Idempotency keys for AI operations.
 *
 * One logical operation gets one key. If the browser retries the same submission — a lost response, a
 * refresh, an impatient second click — the server sees the same key and does not charge twice. A new
 * instruction, a new draft version or a new target produces a new key, so a genuinely new operation is
 * charged normally.
 */

export function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for a context without Web Crypto: still ≥8 chars of the accepted alphabet.
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `op-${random}`;
}

export interface OperationTracker {
  /** Stable id for this exact submission; reused while the submission is unchanged. */
  id(signature: string): string;
  /** Called when the operation reached a definite, server-recorded outcome. */
  settle(): void;
}

export function createOperationTracker(): OperationTracker {
  let current: { signature: string; id: string } | null = null;
  return {
    id(signature: string): string {
      if (!current || current.signature !== signature) current = { signature, id: newOperationId() };
      return current.id;
    },
    settle(): void {
      current = null;
    },
  };
}
