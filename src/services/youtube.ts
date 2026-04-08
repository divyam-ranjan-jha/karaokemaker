/**
 * Thin client for the KaraokeMaker Cloudflare Worker proxy.
 * Worker runs at localhost:8787 in dev (see proxy-worker/).
 * Set VITE_WORKER_URL in .env.local to override.
 */

/** Used when VITE_WORKER_URL is missing from the production build (Vercel env misconfiguration). */
const DEFAULT_PROD_WORKER = 'https://karaokemaker-proxy.divyamranjan1602.workers.dev'

const WORKER_BASE =
  import.meta.env.VITE_WORKER_URL ??
  (import.meta.env.DEV ? 'http://localhost:8787' : DEFAULT_PROD_WORKER)

export interface AudioMeta {
  streamUrl: string
  title: string
  durationSeconds: number
  thumbnailUrl: string | null
}

export class ExtractionError extends Error {
  code: string
  retryable: boolean

  constructor(message: string, code: string, retryable: boolean) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
    this.retryable = retryable
  }
}

export async function extractAudio(url: string): Promise<AudioMeta> {
  const endpoint = `${WORKER_BASE}/extract?url=${encodeURIComponent(url)}`

  // #region agent log
  try {
    const workerHost = (() => {
      try {
        return new URL(WORKER_BASE).host
      } catch {
        return 'invalid-worker-url'
      }
    })()
    fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
      body: JSON.stringify({
        sessionId: 'f57d5f',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'youtube.ts:extractAudio:start',
        message: 'extractAudio start',
        data: { workerHost, dev: import.meta.env.DEV, hasViteWorkerUrl: !!import.meta.env.VITE_WORKER_URL },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
  } catch {
    /* ignore debug */
  }
  // #endregion

  let res: Response
  try {
    res = await fetch(endpoint)
  } catch {
    // #region agent log
    fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
      body: JSON.stringify({
        sessionId: 'f57d5f',
        runId: 'pre-fix',
        hypothesisId: 'H4',
        location: 'youtube.ts:extractAudio:fetch-throw',
        message: 'fetch threw (CORS/network)',
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    throw new ExtractionError(
      'Cannot reach the extraction service. Is the worker running?',
      'NETWORK_ERROR',
      true,
    )
  }

  // #region agent log
  fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
    body: JSON.stringify({
      sessionId: 'f57d5f',
      runId: 'pre-fix',
      hypothesisId: 'H3',
      location: 'youtube.ts:extractAudio:response',
      message: 'fetch response',
      data: { ok: res.ok, status: res.status, ct: res.headers.get('content-type') },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion

  let body: AudioMeta & { error?: string; code?: string; retryable?: boolean }
  try {
    body = (await res.json()) as AudioMeta & { error?: string; code?: string; retryable?: boolean }
  } catch {
    // #region agent log
    fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
      body: JSON.stringify({
        sessionId: 'f57d5f',
        runId: 'pre-fix',
        hypothesisId: 'H2',
        location: 'youtube.ts:extractAudio:json-fail',
        message: 'res.json() failed',
        data: { status: res.status },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    throw new ExtractionError(
      'Extraction service returned an invalid response. Please try again.',
      'EXTRACTION_FAILED',
      true,
    )
  }

  if (!res.ok) {
    throw new ExtractionError(
      body.error ?? 'Audio extraction failed.',
      body.code ?? 'EXTRACTION_FAILED',
      body.retryable ?? true,
    )
  }

  // #region agent log
  fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
    body: JSON.stringify({
      sessionId: 'f57d5f',
      runId: 'pre-fix',
      hypothesisId: 'H3',
      location: 'youtube.ts:extractAudio:success',
      message: 'extract ok',
      data: { hasStreamUrl: !!body.streamUrl, titleLen: (body.title ?? '').length },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion

  return body
}
