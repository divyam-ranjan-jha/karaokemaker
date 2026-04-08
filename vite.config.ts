import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Deployed worker — browser cannot call it directly from localhost (worker CORS is Vercel-only). */
const WORKER_ORIGIN = 'https://karaokemaker-proxy.divyamranjan1602.workers.dev'

const workerExtractProxy = {
  '/km-proxy': {
    target: WORKER_ORIGIN,
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/km-proxy/, ''),
  },
}

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Bundle web workers as ES modules (required for @xenova/transformers).
  worker: {
    format: 'es',
  },

  // Prevent Vite from pre-bundling @xenova/transformers.
  // It uses dynamic WASM imports that must be left as-is for the runtime to resolve.
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },

  // COOP + COEP headers.
  //
  // We use `credentialless` (not `require-corp`) so that cross-origin resources
  // (Invidious thumbnails, HuggingFace model/WASM files) load without needing a
  // `Cross-Origin-Resource-Policy` header on the remote server.
  // `credentialless` still satisfies `crossOriginIsolated` in Chrome 96+ / Firefox 119+,
  // so SharedArrayBuffer is available if we ever enable multi-threaded ONNX.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: workerExtractProxy,
  },

  // Same headers + proxy when previewing the production build locally.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: workerExtractProxy,
  },
})
