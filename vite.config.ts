/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), crx({ manifest })],
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
  },
});
