import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Absolute site URL for canonical + social tags (link previews need absolute image URLs).
 * Order: VITE_SITE_URL → Vercel production URL → Vercel deployment URL → Netlify URL.
 */
function siteUrl(env: Record<string, string>): string {
  const raw =
    env.VITE_SITE_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (env.VERCEL_URL && `https://${env.VERCEL_URL}`) ||
    env.URL ||
    '';
  return raw.replace(/\/$/, '');
}

function siteMeta(url: string): Plugin {
  return {
    name: 'intake-site-meta',
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_URL%', url);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxy = { '^/api(?:/|$)': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001' } };
  return {
    plugins: [react(), siteMeta(siteUrl(env))],
    // CAPTURE=1 also builds the dev-only pages used to record demos / render the social card.
    build: env.CAPTURE ? { rollupOptions: { input: { main: 'index.html', capture: 'capture.html', og: 'og.html' } } } : undefined,
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy },
    preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy },
  };
});
