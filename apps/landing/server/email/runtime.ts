import type { Pool } from 'pg';
import { readEmailConfig, type EmailConfig } from './config';
import { createEmailLogger, type EmailLogger } from './logging';
import {
  createEmailNotifier, createMemorySignInMarkers, createPostgresSignInMarkers, createPostgresUserDirectory,
  type EmailNotifier, type SignInMarkers, type UserDirectory,
} from './notifications';
import { createMemoryOtpStore, createOtpService, createPostgresOtpStore, type OtpService } from './otp';
import { createCalderProvider, createMemoryEmailProvider, type MemoryEmailProvider } from './providers/calder';
import { createEmailService, type EmailService } from './service';
import { createMemoryEmailStore, createPostgresEmailStore } from './store';
import type { EmailProvider, EmailStore } from './types';

/**
 * Wires the email stack for one process.
 *
 * `pool` is injected (it is created in server/auth.ts) so there is no import cycle, and `mode:
 * 'test'` swaps in memory doubles without weakening a single production code path.
 */

export interface EmailRuntimeOptions {
  pool: Pool | null;
  env?: NodeJS.ProcessEnv;
  /** Server secret: keys the OTP HMAC and the sign-in marker hashes. */
  secret: string;
  log?: EmailLogger;
  /** `test` uses memory stores and a memory provider. Never set it in a deployed environment. */
  mode?: 'live' | 'test';
}

export interface EmailUserStore {
  getById(userId: string): Promise<{ id: string; name: string | null; email: string; emailVerified: boolean } | null>;
  setEmailVerified(userId: string): Promise<void>;
  setEmail(userId: string, email: string): Promise<void>;
}

export interface EmailRuntime {
  config: EmailConfig;
  provider: EmailProvider | null;
  store: EmailStore;
  emails: EmailService;
  otp: OtpService;
  notifier: EmailNotifier;
  users: EmailUserStore;
  markers: SignInMarkers;
  directory: UserDirectory;
  /** Present only in test mode: lets a test inspect what would have been delivered. */
  memoryProvider: MemoryEmailProvider | null;
}

export function createEmailRuntime(options: EmailRuntimeOptions): EmailRuntime {
  const env = options.env ?? process.env;
  const log = options.log ?? createEmailLogger();
  const config = readEmailConfig(env);
  const mode = options.mode ?? 'live';
  const live = mode === 'live' && options.pool !== null;

  const store = live ? createPostgresEmailStore(options.pool!) : createMemoryEmailStore();
  const provider: EmailProvider | null = !config.configured
    ? (mode === 'test' ? createMemoryEmailProvider() : null)
    : createCalderProvider({ config });
  const emails = createEmailService({ provider, config, store, log });
  const otp = createOtpService({
    store: live ? createPostgresOtpStore(options.pool!) : createMemoryOtpStore(),
    emails,
    hashKey: options.secret,
    log,
  });

  const directory: UserDirectory = live
    ? createPostgresUserDirectory(options.pool!)
    : { async getById() { return null; } };
  const markers: SignInMarkers = live
    ? createPostgresSignInMarkers(options.pool!, options.secret)
    : createMemorySignInMarkers();
  const notifier = createEmailNotifier({ emails, users: directory, markers, log });

  const users: EmailUserStore = live ? postgresUserStore(options.pool!) : memoryUserStore();

  return {
    config,
    provider,
    store,
    emails,
    otp,
    notifier,
    users,
    markers,
    directory,
    memoryProvider: provider && provider.id === 'memory' ? provider as MemoryEmailProvider : null,
  };
}

function postgresUserStore(pool: Pool): EmailUserStore {
  return {
    async getById(userId) {
      const result = await pool.query<{ id: string; name: string | null; email: string; emailVerified: boolean }>(
        'SELECT id, name, email, "emailVerified" FROM "user" WHERE id = $1 LIMIT 1',
        [userId],
      );
      const row = result.rows[0];
      return row ? { id: row.id, name: row.name, email: row.email, emailVerified: Boolean(row.emailVerified) } : null;
    },
    async setEmailVerified(userId) {
      await pool.query('UPDATE "user" SET "emailVerified" = true, "updatedAt" = now() WHERE id = $1', [userId]);
    },
    async setEmail(userId, email) {
      await pool.query('UPDATE "user" SET email = $2, "emailVerified" = true, "updatedAt" = now() WHERE id = $1', [userId, email]);
    },
  };
}

/** Test double. Mirrors the SQL semantics closely enough for route-level tests. */
function memoryUserStore(seed: Array<{ id: string; name: string | null; email: string; emailVerified: boolean }> = []): EmailUserStore {
  const rows = new Map(seed.map(row => [row.id, { ...row }]));
  return {
    async getById(userId) { return rows.get(userId) ?? null; },
    async setEmailVerified(userId) {
      const row = rows.get(userId);
      if (row) row.emailVerified = true;
    },
    async setEmail(userId, email) {
      const row = rows.get(userId);
      if (row) {
        row.email = email;
        row.emailVerified = true;
      }
    },
  };
}
