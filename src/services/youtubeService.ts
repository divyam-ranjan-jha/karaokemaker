/**
 * Calls the KaraokeMaker Cloudflare Worker proxy to resolve a YouTube URL
 * into a temporary audio stream URL.
 *
 * Uses the same URL rules as `extractAudio` in `./youtube` (Vite proxy on localhost).
 */

import { extractRequestUrl } from './youtube'

// ---------------------------------------------------------------------------
// Types — mirror the worker's response contracts
// ---------------------------------------------------------------------------

export interface ExtractResponse {
  streamUrl: string
  title: string
  durationSeconds: number
  thumbnailUrl: string | null
}

export type ErrorCode =
  | 'INVALID_URL'
  | 'EXTRACTION_FAILED'
  | 'GEO_BLOCKED'
  | 'AGE_RESTRICTED'
  | 'LIVE_STREAM'
  | 'RATE_LIMITED'

export interface ExtractError {
  error: string
  code: ErrorCode
  retryable: boolean
}

export class YouTubeExtractError extends Error {
  code: ErrorCode
  retryable: boolean

  constructor(payload: ExtractError) {
    super(payload.error)
    this.name = 'YouTubeExtractError'
    this.code = payload.code
    this.retryable = payload.retryable
  }
}

// ---------------------------------------------------------------------------
// Service function
// ---------------------------------------------------------------------------

export async function extractAudioStream(youtubeUrl: string): Promise<ExtractResponse> {
  const endpoint = extractRequestUrl(youtubeUrl)

  let res: Response
  try {
    res = await fetch(endpoint)
  } catch {
    throw new YouTubeExtractError({
      error: 'Could not reach the extraction service. Check your internet connection.',
      code: 'EXTRACTION_FAILED',
      retryable: true,
    })
  }

  const body = await res.json() as ExtractResponse | ExtractError

  if (!res.ok) {
    throw new YouTubeExtractError(body as ExtractError)
  }

  return body as ExtractResponse
}
