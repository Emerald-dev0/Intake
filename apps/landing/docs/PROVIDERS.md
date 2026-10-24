# Providers: what works, what is next, and how the next one lands

Intake is a form builder that writes into somebody else's account. That makes the provider list the
product's horizon, not a marketing flourish: every new provider is a new OAuth app, a new scope
negotiation, a new form-writing client, and a new honesty problem on the public site.

This document is the map. For the Typeform console walkthrough specifically, see
[`TYPEFORM.md`](./TYPEFORM.md). For the connection layer's data model, encryption and token
lifecycle, see [`../server/providers/README.md`](../server/providers/README.md).

## Status, in one table

| Provider | Connection | Create | Edit in place | Import | Notes |
| --- | --- | --- | --- | --- | --- |
| Google Forms | Live | Yes | Yes | Yes | `forms.body` only; no Drive, no responses |
| Typeform | Live | Yes | Not yet | Yes | `accounts:read`, `forms:read`, `forms:write`, `offline` |
| Microsoft | Live, identity only | No | No | No | No supported Forms API exists; the UI says so |
| SurveyMonkey | Planned | — | — | — | Public roadmap |
| Google Sheets | Planned | — | — | — | Public roadmap; would need its own narrow sheets scope |
| Jira | Planned | — | — | — | Public roadmap |
| n8n | Planned | — | — | — | Public roadmap |

"Planned" means exactly one thing: the name and mark appear in the homepage roadmap under
**Next in line**, monochrome, behind a `PLANNED` chip, and never in a sentence that implies it works.
No dates. No "coming soon". No waitlist for a provider.

Those four names live in `src/content/site.ts` (`ROADMAP_PROVIDERS`) so the homepage, the footer
roadmap line, the marketing pages and the no-script fallback cannot drift apart. Adding or removing a
name there changes every surface at once.

## The layers a provider touches

Adding one is not a single file. Work through these in order; the checklist at the end is the short
version.

1. **Registry** — `server/providers/registry.ts` defines the OAuth shape: authorization and token
   endpoints, whether PKCE applies, whether an OIDC nonce applies, requested and required scopes,
   the identity probe, revocation support, and the human-readable scope descriptions the consent
   screen shows. Only providers whose registry entry resolves to a configured client id and secret
   appear as connectable.
2. **Connection storage** — `provider_connection` already handles any `provider` id, so a new
   provider normally needs no migration. Tokens are encrypted with AES-256-GCM whose associated data
   binds `user + provider + field`.
3. **Routes** — `server/providers/routes.ts` serves `POST /api/providers/:provider/start` and
   `GET /api/providers/:provider/callback`. A new redirect URI is
   `{BETTER_AUTH_URL}/api/providers/<id>/callback`, and nothing else.
4. **Form client** — `server/forms/providers/<id>/` implements create, read and (where the API allows
   it) update behind the shared boundary. If the provider has no supported API, do not write the
   client and do not fabricate a form: Microsoft is the precedent, and the Connections screen states
   that it records identity only.
5. **Capability reporting** — the connection payload reports `formsApi: supported | unsupported` and
   a short note. The UI renders the note verbatim, so write it for a customer, not for a developer.
6. **Workspace UI** — `src/app/pages/ConnectionsPage.tsx` lists connections; the composer and library
   read capable providers. Nothing in the workspace may offer a provider that cannot act.
7. **Public surfaces** — in this order:
   - `src/components/ProviderLogos.tsx` — add the mark only if you have the brand's real geometry
     (Simple Icons, CC0). Live marks may use brand colour; planned marks are monochrome by
     construction (`PlannedProviderLogo` has no `tone` prop to get wrong).
   - `src/content/site.ts` — `LIVE_PROVIDERS`, `ROADMAP_PROVIDERS`, `ROADMAP_NOTE`, plus the title,
     description and FAQ answers.
   - `vite.config.ts` — the no-script fallback, the `llms.txt` facts, structured data, the sitemap.
   - `src/marketing/*` — hero lede, `#providers` board, footer roadmap line.
8. **Docs** — a `<PROVIDER>.md` runbook beside `TYPEFORM.md` (console steps, redirect URI, scopes and
   why each is asked for, what was verified without a live account, rollback), a row in the table
   above, and a note in `server/providers/README.md`.
9. **Tests** — `test/marketing-content.test.mjs` asserts the built document names the live providers
   and labels the roadmap; `test/marketing-experience.test.mjs` asserts the planned group renders
   monochrome with its `PLANNED` chip. A provider that ships without those assertions is a provider
   that will quietly become a lie on the homepage six months from now.

## The honesty rule

A provider is **live** on the public site only when all four of these are true:

1. the OAuth connection completes against the real provider (not an emulator, not a fixture),
2. the scope list is the narrowest one that makes the feature work, and every extra scope has a
   sentence explaining why,
3. a form is actually created in a real account, and the responder link opens,
4. `docs/<PROVIDER>.md` records what was verified, by whom, and what was not.

Until then it is **planned**: name and mark only, monochrome, behind a chip, with no date.

Anything else — a coloured logo next to a working provider, an FAQ answer in the future tense, a
tooltip saying "beta" — is the kind of claim this project has already had to walk back once. Don't
ship it.

## Checklist

```
[ ] registry entry + env keys in .env.example (never VITE_)
[ ] redirect URI registered: {BETTER_AUTH_URL}/api/providers/<id>/callback
[ ] scopes justified in docs/<PROVIDER>.md, one line each
[ ] identity probe labels the connected account
[ ] form client in server/forms/providers/<id>/ (or a documented "no API" decision)
[ ] capability note written for a customer
[ ] Connections UI + composer only offer what can act
[ ] LIVE_PROVIDERS / ROADMAP_PROVIDERS updated
[ ] homepage hero, #providers board, footer line, FAQ
[ ] no-script fallback + llms.txt + structured data
[ ] marketing tests updated (live marks, planned chips, no-script text)
[ ] tsc (app + server), vite build, full test suite
[ ] runbook + rollback in docs/<PROVIDER>.md
```

## Rollback

Set the provider's client id/secret to empty. The registry stops resolving it, the connect button
disappears, and the server refuses to start an authorization it cannot finish. Existing connections
stay in the database but cannot be refreshed; the UI reports them as needing reconnection. Nothing
breaks for other providers, and no migration is needed.
