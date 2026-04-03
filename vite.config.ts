import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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

  // COOP + COEP headers are required for SharedArrayBuffer, which ONNX Runtime
  // needs for multi-threaded WASM (SIMD). Without them, numThreads is forced to 1.
  // These headers are set here for the dev server; for production add a
  // `_headers` file (Cloudflare Pages) or configure the host accordingly.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Same headers needed when previewing the production build locally.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
