/**
 * Thin client for the KaraokeMaker Cloudflare Worker proxy.
 *
 * Default: deployed worker (works with `npm run dev` alone).
 * For local proxy development: `cd proxy-worker && npm run dev`, then create `.env.local` with
 *   VITE_WORKER_URL=http://localhost:8787
 */

const DEFAULT_WORKER = 'https://karaokemaker-proxy.divyamranjan1602.workers.dev'

/** Where the browser should GET /extract (avoids CORS: worker only allows the Vercel origin). */
export function extractRequestUrl(youtubeUrl: string): string {
  const qs = `url=${encodeURIComponent(youtubeUrl)}`
  const env = import.meta.env.VITE_WORKER_URL
  if (env) return `${env}/extract?${qs}`
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1') {
      return `/km-proxy/extract?${qs}`
    }
  }
  return `${DEFAULT_WORKER}/extract?${qs}`
}

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
  const endpoint = extractRequestUrl(url)

  // #region agent log
  try {
    const kind =
      import.meta.env.VITE_WORKER_URL != null && import.meta.env.VITE_WORKER_URL !== ''
        ? 'env'
        : endpoint.startsWith('/km-proxy')
          ? 'vite-proxy'
          : 'direct-worker'
    fetch('http://127.0.0.1:7816/ingest/6c4612d3-9f5b-4249-ba5b-4d305acc6e89', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f57d5f' },
      body: JSON.stringify({
        sessionId: 'f57d5f',
        runId: 'cors-proxy',
        hypothesisId: 'CORS',
        location: 'youtube.ts:extractAudio:start',
        message: 'extractAudio start',
        data: { kind, dev: import.meta.env.DEV, endpointPrefix: endpoint.slice(0, 48) },
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
