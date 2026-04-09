/**
 * Thin client for the KaraokeMaker Cloudflare Worker proxy.
 *
 * Default: deployed worker (works with `npm run dev` alone).
 * For local proxy development: `cd proxy-worker && npm run dev`, then create `.env.local` with
 *   VITE_WORKER_URL=http://localhost:8787
 */

const DEFAULT_WORKER = 'https://karaokemaker-proxy.divyamranjan1602.workers.dev'

function isLocalhost(): boolean {
  return typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
}

/**
 * Wrap a YouTube CDN stream URL through the Vite audio proxy on localhost.
 * On production (Vercel), the URL is returned as-is (COEP: credentialless allows it).
 */
export function proxyStreamUrl(rawStreamUrl: string): string {
  if (!rawStreamUrl) return rawStreamUrl
  if (isLocalhost()) return `/audio-stream?url=${encodeURIComponent(rawStreamUrl)}`
  return rawStreamUrl
}

/** Where the browser should GET /extract (avoids CORS: worker only allows the Vercel origin). */
export function extractRequestUrl(youtubeUrl: string): string {
  const qs = `url=${encodeURIComponent(youtubeUrl)}`
  const env = import.meta.env.VITE_WORKER_URL
  if (env) return `${env}/extract?${qs}`
  if (isLocalhost()) return `/km-proxy/extract?${qs}`
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

  let res: Response
  try {
    res = await fetch(endpoint)
  } catch {
    throw new ExtractionError(
      'Cannot reach the extraction service. Is the worker running?',
      'NETWORK_ERROR',
      true,
    )
  }

  let body: AudioMeta & { error?: string; code?: string; retryable?: boolean }
  try {
    body = (await res.json()) as AudioMeta & { error?: string; code?: string; retryable?: boolean }
  } catch {
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

  return body
}
