# Release Manager — operator guide

The Release Manager is the private half of the public changelog. It lives in the operator console
(`/admin/releases`), behind the same allowlist and verified session as every other admin route, and
it is the only way a release becomes public.

The public half is `/changelog`: an index and one permanent page per release.

## The workflow

```
draft → in review → approved → (awaiting deployment) → published
                ↘ cancelled ↗
```

| State | What it means | What you can do |
| --- | --- | --- |
| **Draft** | Being written. Never public. | Edit, link sources, generate a draft, send for review. |
| **In review** | Waiting for a second pair of eyes. | Approve, send back. |
| **Approved** | Signed off. Still not public. | Withdraw approval, mark as awaiting deployment, publish. |
| **Awaiting deployment** | Waiting for production to confirm the change is live. | Publish once the deployment is observed as successful. |
| **Published** | Public. It has a permanent URL. | Correct the wording. The URL and the publication date never change. |
| **Cancelled** | Abandoned. Never public, and its slug is not discoverable. | Restore as a draft. |

Rules the server enforces, not the browser:

- a release cannot skip a state — a draft cannot jump straight to published;
- the slug is frozen the moment a release is published, so a shared link never breaks;
- publishing is refused while the checklist is incomplete;
- a draft, a release in review and a cancelled release are answered with **404** by the public API,
  not 403, so an unpublished slug cannot be probed;
- every administrative action is written to the release's audit trail.

## The checklist

Automatic checks are read from real state and are never guessed:

| Check | Source |
| --- | --- |
| Changelog content prepared | Title, summary, notes, categories and a publication date are set, and no `TODO` marker is left in the notes. |
| Production deployment succeeded | The linked deployment was observed as successful by the GitHub Deployments API. |
| Administrator approval recorded | The approval timestamp and the approving administrator. |

Manual checks need a person to answer: **relevant tests passed**, **type check, lint and production
build completed**, **database migrations reviewed**, **documentation updated**, **public-facing
claims verified**, and **preview reviewed**. Until you answer one, it reads *Not confirmed* — never
*Passed*. You may also mark a manual item **not applicable** (for example, a release with no schema
change has no migration to review); that decision is stored and audited.

Automatic checks can only be marked *not applicable* by an administrator, and only with a note.

## Linking GitHub

The integration is optional and server-side. Without it you can still write a release by hand and
link a source by URL.

| Variable | What it does |
| --- | --- |
| `GITHUB_TOKEN` | A fine-grained token with read-only access to the repository. |
| `GITHUB_REPOSITORY` | `owner/repo`, for example `Emerald-dev0/Intake`. |
| `GITHUB_WEBHOOK_SECRET` | The signing secret of the webhook that points at `${BETTER_AUTH_URL}/api/webhooks/github`. |

**Manual steps to turn it on (these need a human with repository access):**

1. Create a fine-grained personal access token: repository → *Contents: read*, *Pull requests: read*,
   *Metadata: read*, *Deployments: read*. No write scopes, no admin scopes.
2. Add it to the API service as `GITHUB_TOKEN`, and set `GITHUB_REPOSITORY` to `owner/repo`.
3. In the repository → *Settings → Webhooks → Add webhook*:
   - Payload URL: `https://<your-api-origin>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: a new random string, added to the API service as `GITHUB_WEBHOOK_SECRET`
   - Events: *Pull requests*, *Deployments*, *Deployment statuses*, *Releases*
4. `npm run preflight -- --db` should report `release manager: pass`.

The token is read only by the API process. It is never sent to the browser, never written to the
database and never logged.

### What the integration actually does

- **Link a source** — the console reads the pull request, commit, release or deployment from the
  GitHub API and stores the title, labels and state it found. It stores no credential and no token.
- **Write a draft** — the console turns a pull request into an editable announcement: the title and
  summary come from the pull request, the categories come from the `release:feature`,
  `release:improvement`, `release:fix` and `release:security` labels, and any section the pull
  request did not write is left as `TODO`. A release with a `TODO` in it cannot be published.
- **Keep the link current** — a signed webhook updates the linked pull request, release or deployment
  when GitHub reports a change.

### What it deliberately does not do

- It does not publish anything by itself. Publication is an administrator's decision.
- A merged pull request is not a deployment, and a successful build is not a deployment. The
  deployment state comes from the GitHub Deployments API, and a release with a linked deployment
  only publishes once that deployment is observed as `success`.
- Automatic publication after a successful deployment exists but is **off**. Turn it on with
  `RELEASE_AUTO_PUBLISH_AFTER_DEPLOYMENT=true`, and it still only acts on a release an administrator
  has already approved and whose checklist is complete.

## Sharing

The share panel writes the copy: the title, one sentence of benefit and the permanent changelog
URL. It is a draft you can edit before you post it. **Copy** reports success only when the browser's
clipboard actually accepted the text; if the browser refuses, the panel says so rather than
pretending.

Intake does not post anywhere. Nothing here publishes to a social platform.

## The database

Migration `022_release_manager.sql` adds five tables: `release`, `release_source`, `release_audit`,
`release_checklist_item` and `release_webhook_event`. It is additive and seeds the shipped releases
that predate the Release Manager so that each of them has a permanent URL.

To roll it back:

```sql
DROP TABLE IF EXISTS release_webhook_event, release_checklist_item, release_audit, release_source, release;
```

Nothing outside the Release Manager reads those tables, and the public changelog falls back to the
release notes bundled with the site (`src/content/changelog.ts`).

## Known limitations

- **The sitemap is generated at build time.** It lists the releases that were known when the site
  was built. A release published later is still linked from the changelog index and still has its own
  permanent page, but it enters the sitemap at the next build.
- **The changelog is client-rendered**, like the other public pages in this application. The
  canonical URL, Open Graph metadata and the article schema are set at runtime, which the crawlers
  that render JavaScript read.
- **The public API returns only published releases.** There is no public feed of drafts, and there is
  no RSS feed.
- **One deployment per release is observed.** A release that ships to several environments records
  the most recently updated deployment.
