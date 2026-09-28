import 'dotenv/config';
import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, pool } from './auth';
import { createTokenCipher } from './providers/crypto';
import { createProviderHttp } from './providers/http';
import { createProviderRouter } from './providers/routes';
import { isProviderConfigured, supportedProviders } from './providers/registry';
import { createPostgresStore } from './providers/postgres-store';
import { createProviderService, useProviderService } from './providers/service';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = express();
app.disable('x-powered-by');
// This route must precede any middleware that consumes the POST body.
const authHandler = toNodeHandler(auth);
app.all('/api/auth/*', (req, res, next) => {
  Promise.resolve(authHandler(req, res)).catch(next);
});

const providerEnv = process.env;
const providerService = createProviderService({
  store: createPostgresStore(pool),
  http: createProviderHttp(),
  cipher: createTokenCipher({ authSecret: process.env.BETTER_AUTH_SECRET ?? '', dedicatedKey: process.env.PROVIDER_TOKEN_KEY }),
  env: providerEnv,
});
useProviderService(providerService);
app.use('/api/providers', createProviderRouter({
  service: providerService,
  env: providerEnv,
  getSession: async req => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) return null;
    return { id: session.user.id, email: session.user.email, name: session.user.name };
  },
}));
const providerSetup = supportedProviders(providerEnv).map(provider => `${provider.id} ${isProviderConfigured(provider, providerEnv) ? 'configured' : 'not configured'}`).join(', ');
console.log(`Provider connections: ${providerSetup}`);

app.get('/api/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    return res.json({ user: session.user });
  } catch (error) {
    console.error('Session lookup failed', error);
    return res.status(503).json({ error: 'Session temporarily unavailable' });
  }
});

// Check the session on *every document request*, not just in React. Do not
// redirect on DB failures: an outage must not masquerade as a signed-out user.
app.get(/^\/app(?:\/|$)/, async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.redirect(303, '/auth/sign-in');
    return next();
  } catch (error) {
    console.error('Protected route session lookup failed', error);
    return res.status(503).send('Intake is temporarily unavailable. Please try again later.');
  }
});

app.use('/api', (_req, res) => res.sendStatus(404));

const dev = process.env.NODE_ENV !== 'production';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = dev ? await import('vite').then(({ createServer }) => createServer({ root, server: { middlewareMode: true }, appType: 'custom' })) : null;
if (vite) app.use(vite.middlewares);
else app.use(express.static(path.join(root, 'dist'), { index: false }));

app.get(/^\/(?:$|auth\/(?:sign-in|sign-up)\/?$|app(?:\/.*)?$)/, async (req, res, next) => {
  try {
    const file = path.join(root, dev ? 'index.html' : 'dist/index.html');
    let html = await readFile(file, 'utf8');
    if (vite) html = await vite.transformIndexHtml(req.originalUrl, html);
    res.set('Cache-Control', 'no-store').type('html').send(html);
  } catch (error) { next(error); }
});

app.use((_req, res) => res.sendStatus(404));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).send('Something went wrong.');
});

const port = Number(process.env.PORT || 5173);
const server = app.listen(port, '0.0.0.0', () => console.log(`Intake listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { server.close(); void vite?.close(); void pool.end(); });
}
