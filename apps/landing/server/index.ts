import 'dotenv/config';
import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, pool } from './auth';
const app = express();
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
// This route must precede any middleware that consumes the POST body.
const authHandler = toNodeHandler(auth);
app.all('/api/auth/*', (req, res, next) => {
  Promise.resolve(authHandler(req, res)).catch(next);
});

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

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

app.use((_req, res) => res.sendStatus(404));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).send('Something went wrong.');
});

const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () => console.log(`Intake listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { server.close(); void pool.end(); });
}
