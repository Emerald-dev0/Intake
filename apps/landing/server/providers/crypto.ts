import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 1;
const DERIVE_SALT = 'intake-provider-tokens';
const DERIVE_INFO = 'v1';

export interface TokenCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
}

export function createTokenCipher(options: { authSecret: string; dedicatedKey?: string }): TokenCipher {
  const key = deriveKey(options.authSecret, options.dedicatedKey);
  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString('base64url');
    },
    decrypt(payload, aad) {
      const bytes = Buffer.from(payload, 'base64url');
      if (bytes.length < 1 + 12 + 16 || bytes[0] !== VERSION) throw new Error('credential_decrypt_failed');
      const iv = bytes.subarray(1, 13);
      const tag = bytes.subarray(13, 29);
      const ciphertext = bytes.subarray(29);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('credential_decrypt_failed');
      }
    },
  };
}

function deriveKey(authSecret: string, dedicatedKey: string | undefined): Buffer {
  const dedicated = dedicatedKey?.trim();
  if (dedicated) {
    const raw = decodeDedicatedKey(dedicated);
    if (raw.length < 32) throw new Error('PROVIDER_TOKEN_KEY must decode to at least 32 bytes.');
    return createHash('sha256').update(raw).digest();
  }
  if (!authSecret || authSecret.length < 32) throw new Error('Cannot encrypt provider credentials without BETTER_AUTH_SECRET or PROVIDER_TOKEN_KEY.');
  return Buffer.from(hkdfSync('sha256', authSecret, DERIVE_SALT, DERIVE_INFO, 32));
}

function decodeDedicatedKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9_-]{43,}$/.test(value) && !value.includes('=')) {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length >= 32) return decoded;
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length >= 32 && !decoded.includes(0xfffd)) return decoded;
  return Buffer.from(value, 'utf8');
}

export function credentialAad(userId: string, provider: string, field: 'access' | 'refresh' | 'verifier', extra = ''): string {
  return `intake:v1:${userId}:${provider}:${field}${extra ? `:${extra}` : ''}`;
}
