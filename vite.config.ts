/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * crxjs scopes each `web_accessible_resources` entry to the `matches` of the
 * content_scripts entry that bundled it. For the parent-stub we use a fake
 * never-match URL (`aft-parent-stub-bundle-marker.invalid/*`) so the script
 * doesn't auto-inject — the background dynamically inject it via
 * `chrome.scripting.executeScript` when an ATS iframe is detected
 * (see service-worker.ts). For that dynamic injection to be able to import
 * the underlying chunks, the WAR matches need to allow `<all_urls>`.
 *
 * Also strip `optional_host_permissions` that are subsumed by `<all_urls>`
 * in host_permissions — Chrome warns about each redundant one at load.
 */
function aftPostProcessManifest() {
  return {
    name: 'aft-post-process-manifest',
    apply: 'build' as const,
    closeBundle() {
      const manifestPath = resolve(__dirname, 'dist/manifest.json');
      if (!existsSync(manifestPath)) return;
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const hasAllUrls =
          Array.isArray(m.host_permissions) &&
          m.host_permissions.includes('<all_urls>');

        if (Array.isArray(m.web_accessible_resources)) {
          for (const entry of m.web_accessible_resources) {
            const matches: unknown = entry.matches;
            if (
              Array.isArray(matches) &&
              matches.some(
                (s) =>
                  typeof s === 'string' &&
                  s.includes('aft-parent-stub-bundle-marker'),
              )
            ) {
              entry.matches = ['<all_urls>'];
            }
          }
        }

        if (hasAllUrls) delete m.optional_host_permissions;

        writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
      } catch (err) {
        console.error('[aft-post-process-manifest] failed:', err);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), aftPostProcessManifest()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      // crxjs handles inputs declared in manifest.json; nothing extra needed here.
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
    // Vite 5 tightened the default CORS allowlist to local HTTP origins only,
    // which blocks the extension's service worker from importing the dev-mode
    // HMR client (`@vite/env`) over chrome-extension://. Allow it explicitly.
    cors: {
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        /^chrome-extension:\/\//,
      ],
    },
    // Belt-and-suspenders for older Vite middleware that ignores `cors.origin`
    // for static asset responses; harmless in production builds (dev server only).
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
