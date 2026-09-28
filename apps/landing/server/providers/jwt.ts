import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export class TokenVerificationError extends Error {
  constructor(readonly reason: 'malformed' | 'signature' | 'claims') {
    super('id_token_rejected');
  }
}

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  n?: string;
  e?: string;
  alg?: string;
}

export function verifyRs256Jwt(token: string, jwks: unknown, checks: {
  audience: string;
  nonceHash: string;
  now: number;
  issuer: (claims: Record<string, unknown>) => boolean;
}): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenVerificationError('malformed');
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new TokenVerificationError('malformed');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenVerificationError('malformed');
  const keys = jwks && typeof jwks === 'object' && Array.isArray((jwks as { keys?: unknown }).keys) ? (jwks as { keys: Jwk[] }).keys : [];
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.n && key.e);
  if (!jwk) throw new TokenVerificationError('signature');
  let key;
  try {
    key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    throw new TokenVerificationError('signature');
  }
  const signature = Buffer.from(parts[2], 'base64url');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify('RSA-SHA256', signed, key, signature)) throw new TokenVerificationError('signature');
  const now = checks.now;
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new TokenVerificationError('claims');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) throw new TokenVerificationError('claims');
  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(checks.audience)) throw new TokenVerificationError('claims');
  if (typeof claims.nonce !== 'string' || !hashEquals(hashSecret(claims.nonce), checks.nonceHash)) throw new TokenVerificationError('claims');
  if (!checks.issuer(claims)) throw new TokenVerificationError('claims');
  return claims;
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function hashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
