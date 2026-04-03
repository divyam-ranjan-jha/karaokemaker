/**
 * Thin client for the KaraokeMaker Cloudflare Worker proxy.
 * Worker runs at localhost:8787 in dev (see proxy-worker/).
 * Set VITE_WORKER_URL in .env.local to override.
 */

const WORKER_BASE = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787'

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

  const body = await res.json() as AudioMeta & { error?: string; code?: string; retryable?: boolean }

  if (!res.ok) {
    throw new ExtractionError(
      body.error ?? 'Audio extraction failed.',
      body.code ?? 'EXTRACTION_FAILED',
      body.retryable ?? true,
    )
  }

  return body
}
