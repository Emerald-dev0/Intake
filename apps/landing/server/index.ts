import 'dotenv/config';
import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, pool, serverConfig } from './auth';
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
import { createOpenAIFormEditInterpreter, createOpenAIFormInterpreter } from './forms/interpretation/openai';
import { createFormDraftRouter } from './forms/interpretation/routes';
import { createPostgresRateLimitStore } from './security/rate-limit';
import { logSafe } from './providers/oauth';
import { newRequestId } from './forms/logging';
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
app.get('/api/health', (_req, res) => res.json({ ok: true }));
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
const providerService = createProviderService({
  store: createPostgresStore(pool),
  http: createProviderHttp(),
  cipher: createTokenCipher({ authSecret: serverConfig.authSecret, dedicatedKey: process.env.PROVIDER_TOKEN_KEY }),
  env: providerEnv,
});
useProviderService(providerService);
// One session lookup, shared by every router that needs the signed-in Intake user.
const getSession = async (req: express.Request): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
};
app.use('/api/providers', createProviderRouter({ service: providerService, env: providerEnv, getSession, abuseLimiter }));

// Form creation and safe edits share the same provider service, user-scoped metadata store,
// interpreter, and per-user model-call limiter. Editing always re-fetches provider state.
const formsProviders = createFormsProviders({ env: providerEnv });
const formStore = createPostgresFormStore(pool);
const formsEngine = createFormEngine({ providers: formsProviders, store: formStore });
const formInterpreter = createOpenAIFormInterpreter({ env: providerEnv });
const formEditInterpreter = createOpenAIFormEditInterpreter({ env: providerEnv });
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
}));
app.use('/api/forms', createFormsRouter({ engine: formsEngine, getSession, env: providerEnv, abuseLimiter, allowDirectCreation: false }));
const providerSetup = supportedProviders(providerEnv).map(provider => `${provider.id} ${isProviderConfigured(provider, providerEnv) ? 'configured' : 'not configured'}`).join(', ');
console.log(`Provider connections: ${providerSetup}`);
console.log('Form creation: google enabled, microsoft pending (no supported Microsoft Forms API)');
console.log(`Form interpretation: ${providerEnv.OPENAI_API_KEY?.trim() ? 'configured' : 'not configured (OPENAI_API_KEY missing)'}`);

app.get('/api/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
    // Copy only the browser contract; future Better Auth custom fields do not become public by accident.
    return res.json({ user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null } });
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
