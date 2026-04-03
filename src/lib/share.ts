/**
 * URL sharing — PRD Section 6.5
 *
 * Format:  /#v={11-char videoId}&l={lz-string compressed + URI-encoded lyrics JSON}
 * Budget:  warn (but still share) if hash exceeds 4 KB
 * Compat:  share URLs have no expiry — the video ID is permanent
 */

import LZString from 'lz-string'
import type { LyricLine } from './lyrics'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PRD: warn the user if the compressed URL exceeds this size. */
const URL_SIZE_WARN_BYTES = 4 * 1024

const YT_ID_PATTERN =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/

// ---------------------------------------------------------------------------
// Video ID helpers
// ---------------------------------------------------------------------------

/** Extract the 11-character YouTube video ID from any YouTube URL variant. */
export function extractVideoId(youtubeUrl: string): string | null {
  return YT_ID_PATTERN.exec(youtubeUrl)?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface EncodeResult {
  /** Full absolute URL ready to share or copy to clipboard. */
  url: string
  /** Byte length of the hash portion — used to decide oversized warning. */
  hashBytes: number
  /**
   * True if the hash exceeds 4 KB.
   * Per PRD: still share it, but surface a warning to the user.
   */
  oversized: boolean
}

/**
 * Encode video ID + lyrics into a share URL.
 *
 * Pipeline:
 *   lyrics → JSON.stringify → LZString.compressToEncodedURIComponent
 *                                           ↑ handles both compress + encodeURIComponent
 *
 * Returns the full absolute URL (`window.location.origin + pathname + hash`).
 */
export function encodeStateToUrl(videoId: string, lyrics: LyricLine[]): EncodeResult {
  const json = JSON.stringify(lyrics)
  // compressToEncodedURIComponent = LZ compress + base64 URL-safe encode.
  // Equivalent to lz-string.compress → encodeURIComponent as specified in the PRD.
  const compressed = LZString.compressToEncodedURIComponent(json)
  const hash = `#v=${videoId}&l=${compressed}`
  const url = `${window.location.origin}${window.location.pathname}${hash}`
  const hashBytes = new TextEncoder().encode(hash).length

  return {
    url,
    hashBytes,
    oversized: hashBytes > URL_SIZE_WARN_BYTES,
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface DecodeResult {
  videoId: string
  /** Canonical YouTube URL for the video — ready to pass to extractAudio(). */
  youtubeUrl: string
  lyrics: LyricLine[]
}

/**
 * Decode a URL hash string into a video ID + lyrics array.
 *
 * Returns null if the hash is missing, malformed, or the decompressed payload
 * fails structural validation (guards against corrupted / tampered links).
 */
export function decodeStateFromUrl(hash: string): DecodeResult | null {
  try {
    if (!hash || hash.length <= 1) return null

    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const videoId = params.get('v')
    const encoded = params.get('l')

    if (!videoId || !VALID_VIDEO_ID.test(videoId)) return null
    if (!encoded) return null

    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null

    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return null

    // Validate each line has the required shape; backfill `words` for links
    // generated before the words field was added (forward-compat).
    const lyrics: LyricLine[] = parsed
      .filter(isRawLyricLine)
      .map((l) => ({
        id: typeof l.id === 'string' ? l.id : crypto.randomUUID(),
        text: l.text as string,
        startMs: l.startMs as number,
        endMs: l.endMs as number,
        words: Array.isArray(l.words) ? l.words : [],
      }))

    if (lyrics.length === 0) return null

    return {
      videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      lyrics,
    }
  } catch {
    return null
  }
}

/** Loose structural guard — intentionally permissive for forward-compat. */
function isRawLyricLine(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.text === 'string' &&
    typeof o.startMs === 'number' &&
    typeof o.endMs === 'number'
  )
}
