/**
 * KaraokeMaker — Cloudflare Worker proxy
 *
 * GET /extract?url={encodedYouTubeURL}
 *
 * Returns: { streamUrl, title, durationSeconds, thumbnailUrl }
 * Errors:  { error: string, code: ErrorCode, retryable: boolean }
 *
 * Audio bytes are never stored. This worker is a stateless URL resolver only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  ALLOWED_ORIGIN: string
}

type ErrorCode =
  | 'INVALID_URL'
  | 'EXTRACTION_FAILED'
  | 'GEO_BLOCKED'
  | 'AGE_RESTRICTED'
  | 'LIVE_STREAM'
  | 'RATE_LIMITED'

interface ExtractResponse {
  streamUrl: string
  title: string
  durationSeconds: number
  thumbnailUrl: string | null
}

interface ErrorResponse {
  error: string
  code: ErrorCode
  retryable: boolean
}

// Invidious API shapes (partial — only fields we use)
interface InvidiousAdaptiveFormat {
  type: string
  url: string
  bitrate: number
  container?: string
}

interface InvidiousThumbnail {
  quality: string
  url: string
  width: number
  height: number
}

interface InvidiousVideoResponse {
  title: string
  author: string
  lengthSeconds: number
  liveNow?: boolean
  isUpcoming?: boolean
  videoThumbnails: InvidiousThumbnail[]
  adaptiveFormats: InvidiousAdaptiveFormat[]
  error?: string
}

// ---------------------------------------------------------------------------
// Invidious instance fallback list
// ---------------------------------------------------------------------------

// Public instances — ordered by reliability. The worker tries each in turn.
// Monitor https://api.invidious.io/ for up-to-date instance health.
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://yt.artemislena.eu',
  'https://invidious.privacyredirect.com',
  'https://inv.nadeko.net',
] as const

const FETCH_TIMEOUT_MS = 8_000

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

const YT_URL_PATTERN =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

function extractVideoId(raw: string): string | null {
  try {
    // Normalise — handle missing protocol
    const normalised = raw.startsWith('http') ? raw : `https://${raw}`
    const match = YT_URL_PATTERN.exec(normalised)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Invidious fetch
// ---------------------------------------------------------------------------

async function fetchFromInvidious(
  instance: string,
  videoId: string,
): Promise<ExtractResponse> {
  const fields = 'title,author,lengthSeconds,liveNow,isUpcoming,videoThumbnails,adaptiveFormats,error'
  const apiUrl = `${instance}/api/v1/videos/${videoId}?fields=${fields}`

  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'KaraokeMaker/1.0 (open-source; personal use)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Invidious ${instance} responded with HTTP ${res.status}`)
  }

  const data = (await res.json()) as InvidiousVideoResponse

  // Invidious embeds errors inside a 200 response in some cases
  if (data.error) {
    const msg = data.error.toLowerCase()
    if (msg.includes('age') || msg.includes('sign in')) {
      throw Object.assign(new Error(data.error), { code: 'AGE_RESTRICTED' })
    }
    if (msg.includes('country') || msg.includes('available') || msg.includes('region')) {
      throw Object.assign(new Error(data.error), { code: 'GEO_BLOCKED' })
    }
    throw new Error(data.error)
  }

  if (data.liveNow || data.isUpcoming) {
    throw Object.assign(new Error('Live streams are not supported'), { code: 'LIVE_STREAM' })
  }

  // Pick best audio-only stream — prefer m4a (audio/mp4) for broadest browser support
  const audioFormats = (data.adaptiveFormats ?? []).filter((f) =>
    f.type.startsWith('audio/'),
  )
  if (audioFormats.length === 0) {
    throw new Error('No audio-only formats found in Invidious response')
  }

  const m4a = audioFormats.find((f) => f.type.includes('mp4') || f.container === 'm4a')
  const best = m4a ?? audioFormats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]

  if (!best.url) {
    throw new Error('Selected audio format has no URL')
  }

  // Pick the largest thumbnail available (maxres → high → medium → first)
  const thumbPriority = ['maxres', 'high', 'medium', 'default']
  const thumbnails = data.videoThumbnails ?? []
  const thumb =
    thumbPriority.reduce<InvidiousThumbnail | null>((found, q) => {
      return found ?? (thumbnails.find((t) => t.quality === q) ?? null)
    }, null) ?? thumbnails[0] ?? null

  return {
    streamUrl: best.url,
    title: data.title ?? 'Unknown title',
    durationSeconds: data.lengthSeconds ?? 0,
    thumbnailUrl: thumb?.url ?? null,
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(
  body: ExtractResponse | ErrorResponse,
  status: number,
  allowedOrigin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(allowedOrigin),
    },
  })
}

function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  retryable: boolean,
  allowedOrigin: string,
): Response {
  const body: ErrorResponse = { error: message, code, retryable }
  return jsonResponse(body as unknown as ExtractResponse, status, allowedOrigin)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigin = env.ALLOWED_ORIGIN ?? '*'

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      })
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return errorResponse('EXTRACTION_FAILED', 'Method not allowed', 405, false, allowedOrigin)
    }

    const url = new URL(request.url)

    if (url.pathname !== '/extract') {
      return errorResponse('EXTRACTION_FAILED', 'Unknown endpoint', 404, false, allowedOrigin)
    }

    // Validate URL param
    const rawYouTubeUrl = url.searchParams.get('url')
    if (!rawYouTubeUrl) {
      return errorResponse('INVALID_URL', 'Missing required parameter: url', 400, false, allowedOrigin)
    }

    const videoId = extractVideoId(decodeURIComponent(rawYouTubeUrl))
    if (!videoId) {
      return errorResponse(
        'INVALID_URL',
        'Not a recognisable YouTube URL. Accepted formats: youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…',
        400,
        false,
        allowedOrigin,
      )
    }

    // Try each Invidious instance in order
    const lastCode: ErrorCode = 'EXTRACTION_FAILED'
    let lastMessage = 'Could not extract audio stream from YouTube'
    const lastRetryable = true

    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        const result = await fetchFromInvidious(instance, videoId)
        return jsonResponse(result, 200, allowedOrigin)
      } catch (err: unknown) {
        const e = err as Error & { code?: string }

        // Non-retryable error codes — stop immediately, don't try next instance
        if (e.code === 'AGE_RESTRICTED') {
          return errorResponse(
            'AGE_RESTRICTED',
            'This video requires sign-in and cannot be played.',
            403,
            false,
            allowedOrigin,
          )
        }
        if (e.code === 'GEO_BLOCKED') {
          return errorResponse(
            'GEO_BLOCKED',
            'This video is unavailable in the region where the server is running.',
            403,
            false,
            allowedOrigin,
          )
        }
        if (e.code === 'LIVE_STREAM') {
          return errorResponse(
            'LIVE_STREAM',
            'Live streams are not supported. Please use a regular video.',
            422,
            false,
            allowedOrigin,
          )
        }

        // Transient failure — try next instance
        lastMessage = e.message ?? lastMessage
        continue
      }
    }

    // All instances failed
    return errorResponse(lastCode, lastMessage, 502, lastRetryable, allowedOrigin)
  },
} satisfies ExportedHandler<Env>
