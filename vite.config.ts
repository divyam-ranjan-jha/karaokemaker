import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'

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

/**
 * Dev-only: streams /audio-stream?url=<encoded> → YouTube CDN,
 * so the browser avoids CORS when fetching audio for PCM decode.
 */
function handleAudioProxy(req: IncomingMessage, res: ServerResponse) {
  const u = new URL(req.url ?? '/', 'http://localhost')
  const target = u.searchParams.get('url')
  if (!target) { res.writeHead(400); res.end('Missing url param'); return }

  const follow = (url: string, hops = 0) => {
    if (hops > 5) { res.writeHead(502); res.end('Too many redirects'); return }
    https.get(url, (upstream) => {
      if ((upstream.statusCode === 301 || upstream.statusCode === 302) && upstream.headers.location) {
        upstream.resume()
        follow(upstream.headers.location, hops + 1)
        return
      }
      res.writeHead(upstream.statusCode ?? 502, {
        'Content-Type': upstream.headers['content-type'] ?? 'audio/mp4',
        'Content-Length': upstream.headers['content-length'] ?? '',
        'Access-Control-Allow-Origin': '*',
      })
      upstream.pipe(res)
    }).on('error', () => {
      res.writeHead(502); res.end('Upstream fetch failed')
    })
  }
  follow(target)
}

function audioStreamProxy(): Plugin {
  return {
    name: 'audio-stream-proxy',
    configureServer(server) {
      server.middlewares.use('/audio-stream', (req, res) => handleAudioProxy(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/audio-stream', (req, res) => handleAudioProxy(req, res))
    },
  }
}

export default defineConfig({
  plugins: [react(), audioStreamProxy()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ES module workers.
  worker: {
    format: 'es',
  },

  // Pre-bundle @xenova/transformers + onnxruntime-web so that Vite's dev server
  // resolves the circular onnxruntime-common init inside ort-web.min.js.
  // Without this, the raw webpack bundle hits registerBackend on an uninitialised module.
  optimizeDeps: {
    include: ['@xenova/transformers', 'onnxruntime-web'],
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
