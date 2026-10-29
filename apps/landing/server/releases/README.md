# Release Manager

The private half of the changelog: the module that prepares, reviews, approves and publishes a
public release, and the small public API that serves the published ones.

## Boundaries

| File | Responsibility |
| --- | --- |
| `contracts.ts` | The domain vocabulary: statuses, categories, source kinds, checklist keys, and the store interface. |
| `validation.ts` | Everything a browser sends, checked from scratch. Produces field errors, never a 500. |
| `checklist.ts` | The readiness checklist. Automatic items are computed from real state; manual items need a person's answer. |
| `service.ts` | The rules: legal state transitions, the publish gate, the frozen slug, and every audit write. |
| `store.ts` | PostgreSQL. The public query filters on `status = 'published'`. |
| `memory-store.ts` | The same contract in memory, for the tests. |
| `github.ts` | The GitHub REST client and the `X-Hub-Signature-256` verifier. Server-only; the token never leaves the process. |
| `drafting.ts` | Turns a pull request into an editable draft. Never invents a claim: missing sections stay `TODO`. |
| `share.ts` | The share copy: the title, one sentence of benefit, and the permanent URL. |
| `routes.ts` | The admin API. Mounted inside `/api/admin`, so it inherits the allowlist and the verified session. |
| `public-routes.ts` | The public API. Published releases only. |
| `webhooks.ts` | Signed, idempotent GitHub deliveries. Never publishes by itself. |

## Invariants

1. **Nothing unpublished is public.** The public endpoints filter on `status = 'published'`, and an
   unknown or unpublished slug is answered with 404 rather than 403.
2. **The slug is permanent.** It is frozen when a release is published, so a shared link never
   breaks. A published release can still be corrected in place.
3. **The server decides.** The browser never submits a status, a category, a publication date or a
   readiness answer that the server has not validated.
4. **Every administrative action is audited.** `release_audit` is append-only from the application's
   point of view.
5. **A deployment is not a merge.** Production state comes from the GitHub Deployments API, and a
   release with a linked deployment only publishes once that deployment is observed as successful.

## The public API

| Route | Response |
| --- | --- |
| `GET /api/releases` | `{ releases: PublicRelease[], total }` — published releases only. |
| `GET /api/releases/:slug` | `{ release: PublicRelease }`, or 404. |

A `PublicRelease` carries the slug, title, summary, body, categories, publication date, publication
timestamp, links and optional image. It carries no actor, no source id and no internal note.

## The webhook

`POST /api/webhooks/github` reads the raw body, verifies `X-Hub-Signature-256` against
`GITHUB_WEBHOOK_SECRET` with a constant-time comparison, and records the delivery id before it
applies anything. A repeated delivery is acknowledged and ignored. Without a configured secret the
endpoint refuses every delivery rather than accepting one.

See [`../../docs/release-manager.md`](../../docs/release-manager.md) for the operator guide and
[`../../docs/release-manager-plan.md`](../../docs/release-manager-plan.md) for the audit and plan.
