import 'dotenv/config';
import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, googleSignInEnabled, pool, RESET_TOKEN_SECONDS, serverConfig } from './auth';
import { isTestCredential } from './email/config';
import { createTokenCipher } from './providers/crypto';
import { createProviderHttp } from './providers/http';
import { createProviderRouter } from './providers/routes';
import { isProviderConfigured, supportedProviders } from './providers/registry';
import { createPostgresStore } from './providers/postgres-store';
import { createProviderService, useProviderService, type SessionUser } from './providers/service';
import { createFormEngine } from './forms/engine';
import { createPostgresFormStore } from './forms/postgres-store';
import { createFormsProviders } from './forms/providers';
import { createPostgresFormEditDraftStore } from './forms/edit-postgres-store';
import { createFormEditRouter } from './forms/edit-routes';
import { createInterpretationLimiter } from './forms/interpretation/routes';
import { createFormsRouter } from './forms/routes';
import { createPostgresDraftStore } from './forms/draft-postgres-store';
import { aiProviderLabel, resolveAiProvider } from './ai/registry';
import { createAiOperationRunner } from './ai/operations';
import { createCreditService } from './credits/service';
import { createPostgresCreditStore } from './credits/ledger';
import { createCreditRouter } from './credits/routes';
import { createFormEditInterpreter, createFormInterpreter } from './forms/interpretation/provider-interpreter';
import { createFormDraftRouter } from './forms/interpretation/routes';
import { createPostgresRateLimitStore } from './security/rate-limit';
import { createSignInRouter } from './sign-in/routes';
import { readAuthenticationMethods } from './sign-in/account-methods';
import { logSafe } from './providers/oauth';
import { newRequestId } from './forms/logging';
import { createAdminRouter } from './admin/routes';
import { createPostgresAdminStore } from './admin/postgres-store';
import { createHmac } from 'node:crypto';
import { setAuthEmailHooks } from './email/bridge';
import { createAccountEmailRouter } from './email/routes';
import { createEmailRuntime } from './email/runtime';
import { calderWebhookHandler } from './email/webhooks';
import { createBillingRuntime, createBillingRouter, createBachsWebhookRouter } from './billing';
const app = express();
app.disable('x-powered-by');
if (serverConfig.trustProxyHops > 0) app.set('trust proxy', serverConfig.trustProxyHops);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (serverConfig.production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!res.get('X-Request-Id')) res.set('X-Request-Id', newRequestId());
  next();
});
/**
 * Liveness by default: what Render's health check needs, and nothing about internal architecture.
 *
 * `?deep=1` additionally probes PostgreSQL with a bounded read. It is opt-in so a database blip can
 * never make Render recycle a healthy process, while operators and the production verification
 * script still get a truthful readiness answer. No credential, hostname or version is ever returned.
 */
app.get('/api/health', async (req, res) => {
  if (req.query.deep !== '1') return res.json({ ok: true });
  const started = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Database health probe timed out')), 4_000);
        timer.unref?.();
      }),
    ]);
    return res.json({ ok: true, database: 'ok', latencyMs: Date.now() - started });
  } catch (error) {
    logSafe('Database health probe failed', error);
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
});
// Public sign-in capabilities (booleans only). Mounted before the API 404 below.
app.use('/api/sign-in', createSignInRouter({ env: process.env }));
// This route must precede application body middleware. The parsers enforce the bound for both
// declared and chunked bodies; Better Auth's Node adapter safely re-serializes req.body.
const authHandler = toNodeHandler(auth);
const authJson = express.json({ limit: '64kb', strict: true, type: ['application/json', 'application/*+json'] });
const authForm = express.urlencoded({ limit: '64kb', extended: false, parameterLimit: 100 });
app.all('/api/auth/*', (req, res, next) => {
  const declared = Number(req.get('content-length'));
  if (Number.isFinite(declared) && declared > 64 * 1024) return res.status(413).json({ error: 'Authentication request is too large.' });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && (declared > 0 || Boolean(req.get('transfer-encoding')));
  if (hasBody && !req.is('application/json') && !req.is('application/*+json') && !req.is('application/x-www-form-urlencoded')) {
    return res.status(415).json({ error: 'Authentication requests must use JSON or form encoding.' });
  }
  return authJson(req, res, error => error ? next(error) : authForm(req, res, error => error ? next(error) : Promise.resolve(authHandler(req, res)).catch(next)));
});

const providerEnv = process.env;
const abuseLimiter = createPostgresRateLimitStore(pool, serverConfig.authSecret);
/**
 * The email stack. Everything above this line (routes, auth hooks, providers, credits) speaks
 * `emailService`/`notifier`; only `server/email/providers/calder.ts` knows Calder's HTTP API.
 */
const emailRuntime = createEmailRuntime({ pool, env: providerEnv, secret: serverConfig.authSecret });

/**
 * Calder delivery webhooks. Mounted on an unparsed route: the HMAC covers the raw bytes, so the
 * body must never be JSON-parsed before the signature is verified.
 */
app.post('/api/webhooks/calder', calderWebhookHandler({ store: emailRuntime.store, config: emailRuntime.config }));
const providerService = createProviderService({
  store: createPostgresStore(pool),
  http: createProviderHttp(),
  cipher: createTokenCipher({ authSecret: serverConfig.authSecret, dedicatedKey: process.env.PROVIDER_TOKEN_KEY }),
  env: providerEnv,
  // Connecting or disconnecting a forms account is a security-relevant change: the owner is told.
  onConnectionChange: event => {
    const notifier = emailRuntime.notifier;
    void (event.type === 'connected'
      ? notifier.providerConnected(event.userId, event.provider, event.accountLabel ?? '')
      : notifier.providerDisconnected(event.userId, event.provider, event.accountLabel ?? ''));
  },
});
useProviderService(providerService);
// One session lookup, shared by every router that needs the signed-in Intake user.
const getSession = async (req: express.Request): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
};
const adminStore = createPostgresAdminStore(pool, providerEnv);
app.use('/api/admin', createAdminRouter({ store: adminStore, getSession, rateLimiter: abuseLimiter, env: providerEnv }));
app.use('/api/providers', createProviderRouter({ service: providerService, env: providerEnv, getSession, abuseLimiter }));

// Form creation and safe edits share the same provider service, user-scoped metadata store,
// interpreter, and per-user model-call limiter. Editing always re-fetches provider state.
const formsProviders = createFormsProviders({ env: providerEnv });
const formStore = createPostgresFormStore(pool);
const formsEngine = createFormEngine({ providers: formsProviders, store: formStore });
// Provider-independent: routes and drafts never learn which vendor produced the structured output.
const aiProvider = resolveAiProvider({ env: providerEnv });
const formInterpreter = createFormInterpreter({ provider: aiProvider });
const formEditInterpreter = createFormEditInterpreter({ provider: aiProvider });
// Credits are server-owned: the browser never submits a user, a plan, a price or a balance.
const creditService = createCreditService({
  store: createPostgresCreditStore(pool),
  onError: (label, error) => logSafe(label, error),
  // One low-credit notice per account per UTC day, sent after the charge it describes.
  onLowBalance: input => { void emailRuntime.notifier.creditsLow(input.userId, input.remaining, input.nextDailyReset); },
});
const aiOperations = createAiOperationRunner({ credits: creditService, onError: (label, error) => logSafe(label, error) });

/**
 * The billing stack. Subscriptions, credit packs, payments and Bachs webhooks.
 * The billing runtime wires the payment provider, store, and service together.
 */
const billingRuntime = createBillingRuntime({ pool, credits: creditService, notifier: emailRuntime.notifier, env: providerEnv });

const interpretationLimiter = createInterpretationLimiter();
// Phase 6 creation drafts: confirmation still delegates to the same creation engine.
app.use('/api/forms', createFormDraftRouter({
  store: createPostgresDraftStore(pool),
  interpreter: formInterpreter,
  engine: formsEngine,
  getSession,
  env: providerEnv,
  limiter: interpretationLimiter,
  abuseLimiter,
  operations: aiOperations,
}));
// Phase 7 edit proposals are separate from creation drafts and only target a known Google Form.
app.use('/api/forms', createFormEditRouter({
  providers: formsProviders,
  forms: formStore,
  drafts: createPostgresFormEditDraftStore(pool),
  interpreter: formEditInterpreter,
  getSession,
  env: providerEnv,
  limiter: interpretationLimiter,
  abuseLimiter,
  operations: aiOperations,
}));
// Balance only: plan, remaining daily/monthly credits, and the next reset instants.
app.use('/api/credits', createCreditRouter({ credits: creditService, getSession }));
// Billing: subscriptions, credit packs, checkout and billing history.
app.use('/api/billing', createBillingRouter({
  billing: billingRuntime.service,
  store: billingRuntime.store,
  paymentProvider: billingRuntime.provider,
  getSession,
}));
// Bachs payment webhooks: raw body, signature verified, no auth required.
app.use('/api/webhooks/bachs', createBachsWebhookRouter({
  billing: billingRuntime.service,
  paymentProvider: billingRuntime.provider,
}));
// Account email: verification, email change and password reset. Server-authorised throughout.
app.use('/api/account/email', createAccountEmailRouter({
  emails: emailRuntime.emails,
  otp: emailRuntime.otp,
  notifier: emailRuntime.notifier,
  config: emailRuntime.config,
  getSession,
  users: emailRuntime.users,
  requestPasswordReset: email => requestPasswordReset(email),
  abuseLimiter,
  hashKey: serverConfig.authSecret,
}));
app.use('/api/forms', createFormsRouter({ engine: formsEngine, getSession, env: providerEnv, abuseLimiter, allowDirectCreation: false }));
/**
 * Password reset: Better Auth generates, stores, expires and single-uses the token; Intake sends the
 * email. The link always points at Intake. The idempotency key hashes the token so a reset token is
 * never written to the delivery table or a log line.
 */
async function requestPasswordReset(email: string): Promise<void> {
  const response = await auth.api.requestPasswordReset({
    body: { email },
    headers: new Headers({ origin: serverConfig.publicOrigin }),
    asResponse: false,
  }).catch(error => {
    logSafe('Password reset request failed', error);
    return null;
  });
  if (!response) throw new Error('Password reset could not be started.');
}

setAuthEmailHooks({
  async sendPasswordReset({ userId, email, name, token }) {
    const tokenRef = createHmac('sha256', serverConfig.authSecret).update(`intake-reset:v1:${token}`).digest('hex').slice(0, 32);
    await emailRuntime.emails.send({
      type: 'password_reset',
      to: email,
      eventId: `password-reset:${tokenRef}`,
      userId,
      variables: {
        userName: name ?? '',
        expiryMinutes: String(Math.round(RESET_TOKEN_SECONDS / 60)),
        resetUrl: `${serverConfig.publicOrigin}/auth/reset-password?token=${encodeURIComponent(token)}`,
      },
    });
  },
  async onPasswordReset(userId) {
    await emailRuntime.notifier.passwordChanged(userId);
  },
  async onNewSession({ userId, networkSubject }) {
    await emailRuntime.notifier.newSignIn(userId, networkSubject);
  },
  async onAccountLinked({ userId }) {
    await emailRuntime.notifier.googleConnected(userId);
  },
  async onAccountUnlinked({ userId }) {
    await emailRuntime.notifier.googleDisconnected(userId);
  },
});

const providerSetup = supportedProviders(providerEnv).map(provider => `${provider.id} ${isProviderConfigured(provider, providerEnv) ? 'configured' : 'not configured'}`).join(', ');
console.log(`Sign-in: email/password enabled, google ${googleSignInEnabled ? 'configured' : 'not configured'}`);
console.log(`Provider connections: ${providerSetup}`);
console.log('Form creation: google enabled, microsoft pending (no supported Microsoft Forms API)');
console.log(`Form interpretation: ${aiProviderLabel(providerEnv)}`);
console.log(`Transactional email: ${emailRuntime.config.configured ? `calder (${isTestCredential(emailRuntime.config) ? 'test key' : 'live key'}, ${emailRuntime.config.fromEmail || emailRuntime.config.senderId || 'sender id'})` : 'not configured'}`);
console.log(`Billing: ${billingRuntime.config.configured ? 'bachs configured' : 'not configured (checkout disabled)'}`);

app.get('/api/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
    // Copy only the browser contract; future Better Auth custom fields do not become public by accident.
    // The account query exposes only safe provider identifiers and cannot affect authentication if its
    // optional settings read is unavailable.
    const authenticationMethods = await readAuthenticationMethods(pool, session.user.id).catch(error => {
      logSafe('Authentication method summary unavailable', error);
      return { available: false, methods: [] };
    });
    return res.json({
      user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null },
      authenticationMethods,
    });
  } catch (error) {
    logSafe('Session lookup failed', error);
    return res.status(503).json({ error: 'Session temporarily unavailable' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

app.use((_req, res) => res.sendStatus(404));
app.use((error: Error & { status?: number }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const clientStatus = error.status === 400 || error.status === 413 ? error.status : null;
  if (!clientStatus) logSafe('Unhandled API error', error, `${req.method} ${req.path}`);
  const status = clientStatus ?? 500;
  const message = status === 413 ? 'Request body is too large.' : status === 400 ? 'Request body is invalid.' : 'Something went wrong.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message, requestId: res.get('X-Request-Id') ?? '' });
  return res.status(status).send(message);
});

const port = serverConfig.port;
const server = app.listen(port, '0.0.0.0', () => console.log(`Intake listening on ${port}`));
let shutdownStarted = false;
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  process.exitCode = exitCode;
  console.log(`Intake shutdown started (${reason})`);
  const forceClose = setTimeout(() => {
    logSafe('Shutdown grace period expired');
    server.closeAllConnections();
  }, 10_000);
  forceClose.unref();
  try {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } catch (error) {
    logSafe('HTTP server shutdown failed', error);
    process.exitCode = 1;
  }
  try {
    await pool.end();
  } catch (error) {
    logSafe('Database pool shutdown failed', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(forceClose);
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
process.once('uncaughtException', error => {
  logSafe('Uncaught process error', error);
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', error => {
  logSafe('Unhandled promise rejection', error);
  void shutdown('unhandledRejection', 1);
});
