# Sign-in

Who somebody is (`user`, `session`, `account`) is separate from what they have authorized
(`provider_connection`). This folder only owns the first question, for the extra sign-in methods
Intake offers beyond email/password.

## Two Google integrations, never one

| | Google **sign-in** | Google **Forms** connection |
| --- | --- | --- |
| User-visible action | `Continue with Google` | `Connect Google Forms` |
| Purpose | Authenticate into Intake | Let Intake create/edit the user's forms |
| Credentials | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| Scopes | identity only (`openid email profile`) | `https://www.googleapis.com/auth/forms.body` |
| Callback | `/api/auth/callback/google` (Better Auth) | `/api/providers/google/callback` |
| Storage | Better Auth `account` row | `provider_connection` row (encrypted tokens) |

Signing in with Google never creates a `provider_connection`, and connecting Google Forms never
grants sign-in. Nothing in `server/providers/` reads Better Auth accounts; nothing here reads
provider connections.

## Configuration

Set both variables on the **API service** (Render) only, never as `VITE_*`:

```text
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

Leave both blank to disable Google sign-in; the UI then hides the button and only email/password is
offered. Setting exactly one is a startup error, so an inconsistent deployment fails loudly instead
of offering a button that cannot complete.

Register these redirect URIs on the Google OAuth client used for sign-in:

```text
${BETTER_AUTH_URL}/api/auth/callback/google          (production, HTTPS)
http://localhost:5173/api/auth/callback/google       (local development)
```

`BETTER_AUTH_URL` is the exact public origin the browser uses. The sign-in client must **not** be the
same Google Cloud client as the Forms connection: keep consent screens, scopes and secrets apart so
a sign-in can never carry `forms.body`.

## Account linking

`ACCOUNT_LINKING_POLICY` in `google.ts` is intentionally conservative:

- Google is the only trusted provider.
- Intake has no email-verification flow, so `email-password` is **not** trusted. Anyone could
  otherwise register an unverified password account for somebody else's address and inherit the
  Google-linked account created later.
- Consequences:
  - new Google email → new Intake account;
  - returning Google user → normal sign-in;
  - Google email that already belongs to a password account → Better Auth redirects with
    `?error=account_not_linked`. The user signs in with the password and links Google explicitly
    (`linkSocial`), which is a deliberate confirmation rather than a silent merge.

## What is still required in production

Better Auth's own schema (`user`, `session`, `account`, `verification`) already exists in the
database; social sign-in adds rows, not tables. Live Google sign-in has **not** been exercised in
this repository — no real Google Cloud client exists in the checkout. Verify it on the deployed
origin after registering the redirect URIs above.
