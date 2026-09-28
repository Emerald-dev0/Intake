export interface ProviderHttp {
  postForm(url: string, body: URLSearchParams): Promise<{ status: number; json: unknown }>;
  getJson(url: string, headers?: Record<string, string>): Promise<{ status: number; json: unknown }>;
}

const jwksCache = new Map<string, { expires: number; json: unknown }>();

export function createProviderHttp(): ProviderHttp {
  return {
    postForm(url, body) {
      return request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
    },
    async getJson(url, headers = {}) {
      const cached = jwksCache.get(url);
      if (cached && cached.expires > Date.now() && url.includes('/discovery/')) return { status: 200, json: cached.json };
      const result = await request(url, { method: 'GET', headers: { accept: 'application/json', ...headers } });
      if (url.includes('/discovery/') && result.status === 200) jwksCache.set(url, { expires: Date.now() + 10 * 60 * 1000, json: result.json });
      return result;
    },
  };
}

async function request(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  const text = await response.text();
  if (!text) return { status: response.status, json: null };
  try {
    return { status: response.status, json: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, json: null };
  }
}
