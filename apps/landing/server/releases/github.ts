/**
 * GitHub integration for the Release Manager.
 *
 * Scope and shape:
 *   - **Server only.** The token is read from the environment and never reaches the browser.
 *   - **Least privilege.** A fine-grained token with read-only access to the repository is enough
 *     for everything here: pull requests, files, commits, releases and deployments.
 *   - **Documented API only.** The client calls the public GitHub REST endpoints
 *     (`/repos/{owner}/{repo}/pulls/{number}`, `/files`, `/deployments`,
 *     `/deployments/{id}/statuses`, `/commits/{sha}`, `/releases/{tag}`) and the documented
 *     `X-Hub-Signature-256` webhook scheme. No endpoint or event name is invented.
 *   - **Honest when absent.** Without a token the admin console says the integration is not
 *     configured; manual drafting and manual linking keep working.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GitHubConfig {
  token: string | null;
  /** `owner/repo`. */
  repository: string | null;
  owner: string | null;
  repo: string | null;
  webhookSecret: string | null;
  apiBaseUrl: string;
  configured: boolean;
}

export const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 8_000;

export function readGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  const token = (env.GITHUB_TOKEN ?? '').trim() || null;
  const repository = (env.GITHUB_REPOSITORY ?? '').trim() || null;
  const webhookSecret = (env.GITHUB_WEBHOOK_SECRET ?? '').trim() || null;
  const apiBaseUrl = (env.GITHUB_API_BASE_URL ?? '').trim() || GITHUB_API_BASE;
  const parts = repository && repository.includes('/') ? repository.split('/') : [];
  const owner = parts[0]?.trim() || null;
  const repo = parts[1]?.trim() || null;
  return {
    token,
    repository,
    owner,
    repo,
    webhookSecret,
    apiBaseUrl,
    configured: Boolean(token && owner && repo),
  };
}

export class GitHubError extends Error {
  constructor(readonly code: 'not_configured' | 'not_found' | 'unauthorized' | 'rate_limited' | 'server_error' | 'invalid_request', message: string, readonly status = 0) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  htmlUrl: string;
  author: string;
  labels: string[];
  headSha: string;
  baseRef: string;
  createdAt: string | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  /** File paths, capped by the caller. */
  files: string[];
}

export interface GitHubDeployment {
  id: number;
  ref: string;
  sha: string;
  environment: string;
  /** `success`, `failure`, `error`, `in_progress`, `queued`, `pending`, `unknown`. */
  state: string;
  description: string | null;
  url: string | null;
  createdAt: string | null;
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  draft: boolean;
  prerelease: boolean;
}

async function githubFetch<T>(config: GitHubConfig, path: string): Promise<T> {
  if (!config.configured || !config.token) throw new GitHubError('not_configured', 'The GitHub integration is not configured on this server.');
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'intake-release-manager',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) throw new GitHubError('not_found', 'GitHub has no record of that item.', 404);
  if (response.status === 401 || response.status === 403) {
    const rateLimited = response.headers.get('x-ratelimit-remaining') === '0';
    throw new GitHubError(rateLimited ? 'rate_limited' : 'unauthorized', rateLimited ? 'GitHub rate-limited this server. Try again later.' : 'GitHub rejected the configured token.', response.status);
  }
  if (response.status >= 500) throw new GitHubError('server_error', 'GitHub is unavailable right now.', response.status);
  if (!response.ok) throw new GitHubError('invalid_request', 'GitHub refused the request.', response.status);
  return (await response.json()) as T;
}

interface PullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  merged_at: string | null;
  html_url: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string }> | null;
  head?: { sha?: string } | null;
  base?: { ref?: string } | null;
  created_at?: string | null;
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

interface PullRequestFilePayload {
  filename?: string;
}

export async function fetchPullRequest(config: GitHubConfig, number: number): Promise<GitHubPullRequest> {
  if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubError('invalid_request', 'A pull request number is required.');
  const pull = await githubFetch<PullRequestPayload>(config, `/repos/${config.owner}/${config.repo}/pulls/${number}`);
  let files: string[] = [];
  try {
    const listed = await githubFetch<PullRequestFilePayload[]>(config, `/repos/${config.owner}/${config.repo}/pulls/${number}/files?per_page=100`);
    files = listed.map(file => file.filename ?? '').filter(Boolean).slice(0, 100);
  } catch {
    // The file list is context for the draft, never a requirement for linking the pull request.
    files = [];
  }
  return {
    number: pull.number,
    title: pull.title ?? '',
    body: pull.body ?? '',
    state: pull.state ?? 'open',
    merged: Boolean(pull.merged),
    mergedAt: pull.merged_at ?? null,
    htmlUrl: pull.html_url ?? '',
    author: pull.user?.login ?? '',
    labels: (pull.labels ?? []).map(label => label.name ?? '').filter(Boolean),
    headSha: pull.head?.sha ?? '',
    baseRef: pull.base?.ref ?? '',
    createdAt: pull.created_at ?? null,
    changedFiles: pull.changed_files ?? files.length,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    files,
  };
}

interface DeploymentPayload {
  id: number;
  ref?: string;
  sha?: string;
  environment?: string;
  description?: string | null;
  task?: string;
  created_at?: string;
  statuses_url?: string;
}

interface DeploymentStatusPayload {
  state?: string;
  description?: string | null;
  environment_url?: string | null;
  created_at?: string;
}

/** The latest deployment for a ref, with the status GitHub reports for it. */
export async function fetchLatestDeployment(config: GitHubConfig, ref?: string): Promise<GitHubDeployment | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}&per_page=5` : '?per_page=5';
  const deployments = await githubFetch<DeploymentPayload[]>(config, `/repos/${config.owner}/${config.repo}/deployments${query}`);
  const deployment = deployments[0];
  if (!deployment) return null;
  const statuses = await githubFetch<DeploymentStatusPayload[]>(config, `/repos/${config.owner}/${config.repo}/deployments/${deployment.id}/statuses?per_page=10`);
  const status = statuses[0];
  return {
    id: deployment.id,
    ref: deployment.ref ?? '',
    sha: deployment.sha ?? '',
    environment: deployment.environment ?? '',
    state: normaliseDeploymentState(status?.state),
    description: status?.description ?? deployment.description ?? null,
    url: status?.environment_url ?? null,
    createdAt: deployment.created_at ?? status?.created_at ?? null,
  };
}

/** GitHub deployment states, mapped onto the small vocabulary the Release Manager stores. */
export function normaliseDeploymentState(state: string | undefined | null): GitHubDeployment['state'] {
  const value = (state ?? '').toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'failure') return 'failure';
  if (value === 'error') return 'error';
  if (value === 'in_progress') return 'in_progress';
  if (value === 'queued' || value === 'pending') return 'queued';
  return 'unknown';
}

interface CommitPayload {
  sha: string;
  html_url?: string;
  commit?: { message?: string };
}

export async function fetchCommit(config: GitHubConfig, sha: string): Promise<{ sha: string; url: string; message: string }> {
  const commit = await githubFetch<CommitPayload>(config, `/repos/${config.owner}/${config.repo}/commits/${encodeURIComponent(sha)}`);
  return { sha: commit.sha, url: commit.html_url ?? '', message: commit.commit?.message ?? '' };
}

interface ReleasePayload {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

export async function fetchGitHubRelease(config: GitHubConfig, tag: string): Promise<GitHubRelease> {
  const release = await githubFetch<ReleasePayload>(config, `/repos/${config.owner}/${config.repo}/releases/tags/${encodeURIComponent(tag)}`);
  return {
    tagName: release.tag_name ?? tag,
    name: release.name ?? release.tag_name ?? tag,
    body: release.body ?? '',
    htmlUrl: release.html_url ?? '',
    publishedAt: release.published_at ?? null,
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
  };
}

/**
 * Verify a GitHub webhook signature.
 *
 * The documented scheme: `X-Hub-Signature-256: sha256=<hex hmac>` over the raw request body, keyed
 * with the webhook secret. The comparison is constant time, and a missing secret or a missing
 * header is a refusal rather than a permissive default.
 */
export function verifyGitHubSignature(rawBody: string, signatureHeader: string | undefined, secret: string | null): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const provided = signatureHeader.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/** Pull request numbers can be written as `#12`, `12`, or a full pull request URL. */
export function parsePullRequestReference(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const urlMatch = value.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/|$)/i);
  const candidate = urlMatch ? urlMatch[1] : value.replace(/^#/, '');
  if (!/^\d+$/.test(candidate)) return null;
  const number = Number(candidate);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Commit shas are 7–40 hexadecimal characters. */
export function parseCommitReference(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(value)) return null;
  return value;
}

/** Release tags are short strings; keep them conservative so a path can never be injected. */
export function parseReleaseTag(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 120) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
  return value;
}
