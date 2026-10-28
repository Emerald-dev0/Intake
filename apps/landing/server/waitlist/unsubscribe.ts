/**
 * The unsubscribe endpoint every launch email links to.
 *
 * A `GET` that a reader can click from any client, that works twice, and that answers in a page
 * rather than JSON — someone who clicked "unsubscribe" should not be handed `{"ok":true}`.
 *
 * It reveals nothing: a wrong token and a missing row answer identically, so this cannot be used to
 * test whether an address is on the list.
 */
import { Router } from 'express';
import { isWaitlistId, verifyUnsubscribeToken, type LaunchStore } from './launch';

export interface UnsubscribeRouterDeps {
  store: Pick<LaunchStore, 'unsubscribe'>;
  /** The same secret that signed the token. Signing and verifying never disagree by construction. */
  secret: string;
}

function page(title: string, message: string, status: 'done' | 'problem'): string {
  const accent = status === 'done' ? '#ff5a1f' : '#8a3b1f';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" /><title>${title} · Intake</title></head>
<body style="margin:0;background:#f4efe6;font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24231f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:64px 20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
    <tr><td style="padding:0 0 22px;font:600 17px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:-.02em;color:#0c0c0b">intake<span style="color:#ff5a1f">.</span></td></tr>
    <tr><td bgcolor="#fffdf9" style="background:#fffdf9;border:1px solid #ded5c4;border-radius:6px;padding:34px 32px">
      <p style="margin:0 0 12px;font:600 10px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:${accent}">${status === 'done' ? 'Done' : 'Link problem'}</p>
      <h1 style="margin:0 0 14px;font:400 27px/1.25 Georgia,serif;letter-spacing:-.015em;color:#0c0c0b">${title}</h1>
      <p style="margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24231f">${message}</p>
    </td></tr>
    <tr><td style="padding:20px 4px 0;font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#6f6a5f">
      Changed your mind? Write to <a href="https://intake.calder.click" style="color:#6f6a5f">intake.calder.click</a>.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

export function createUnsubscribeRouter(deps: UnsubscribeRouterDeps): Router {
  const router = Router();
  router.get('/', (req, res, next) => {
    void (async () => {
      try {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        const id = typeof req.query.id === 'string' ? req.query.id : '';
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!isWaitlistId(id) || !verifyUnsubscribeToken(id, token, deps.secret)) {
          res.status(400).type('html').send(page(
            'That link is not valid.',
            'The unsubscribe link may have been cut in half by your mail app. Reply to any Intake email and ask to be removed — it will be done by hand.',
            'problem',
          ));
          return;
        }
        await deps.store.unsubscribe(id);
        res.status(200).type('html').send(page(
          'You are off the list.',
          'No more launch or update emails from Intake. Anything about an account you actually have — a password reset, a security notice — will still reach you, because those are not marketing.',
          'done',
        ));
      } catch (error) {
        next(error);
      }
    })();
  });
  return router;
}
