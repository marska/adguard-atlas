import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { STATIC_DEMO_CONFIG } from './src/shared/types';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The static demo has nothing to connect to, and says so (section 7 of the
 * specification): `connect-src 'none'`.
 */
const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `npm run build:demo` (F27): bakes the demo configuration into index.html, adds
 * the policy as a meta tag so it holds on any static host, and writes a `_headers`
 * file so Cloudflare Pages sends it as a real header too.
 */
function staticDemo(): Plugin {
  return {
    name: 'atlas-static-demo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html: html.replace('__ATLAS_CONFIG__', escapeAttribute(JSON.stringify(STATIC_DEMO_CONFIG))),
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: DEMO_CSP.join('; ') },
              injectTo: 'head-prepend',
            },
          ],
        };
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${[...DEMO_CSP, "frame-ancestors 'none'"].join('; ')}`,
          '  X-Content-Type-Options: nosniff',
          '  X-Frame-Options: DENY',
          '  Referrer-Policy: no-referrer',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
          '',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: here('./src/web'),
    // Relative URLs: the page works under any path prefix of a reverse proxy.
    base: './',
    plugins: [react(), demo ? staticDemo() : null],
    build: {
      outDir: here(demo ? './dist/demo' : './dist/web'),
      emptyOutDir: true,
      target: 'es2022',
      // Nothing may be inlined as data: URLs or fetched by a polyfill; the
      // Content-Security-Policy allows neither.
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 2000,
    },
  };
});
