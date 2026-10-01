export interface ProviderHttp {
  postForm(url: string, body: URLSearchParams): Promise<{ status: number; json: unknown }>;
  getJson(url: string, headers?: Record<string, string>): Promise<{ status: number; json: unknown }>;
}

const jwksCache = new Map<string, { expires: number; json: unknown }>();
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('provider_response_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('provider_response_too_large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

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
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  const text = await limitedText(response);
  if (!text) return { status: response.status, json: null };
  try {
    return { status: response.status, json: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, json: null };
  }
}
