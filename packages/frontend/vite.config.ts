/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite dev server proxies API + WS requests to the local Worker (`wrangler dev`).
// The Worker dev port defaults to 8787.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // jsdom is required for the component-level tests under src/components/.
    // Pure logic tests (e.g. computeDisplayHand) work in either environment;
    // jsdom is a small superset, so use it everywhere for simplicity.
    environment: 'jsdom',
  },
});
