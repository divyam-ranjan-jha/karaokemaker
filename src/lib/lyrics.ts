/**
 * Shared lyrics types and utilities used by both the main thread and
 * the Whisper web worker (workers can import @/ paths in Vite).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single word with its start timestamp (derived from Whisper output). */
export interface LyricWord {
  text: string
  startMs: number
}

/**
 * One display line of lyrics.
 * `words` holds per-word start timestamps for word-by-word highlighting.
 * When lyrics are pasted manually (no Whisper timestamps) `words` is [].
 */
export interface LyricLine {
  id: string
  text: string
  startMs: number
  endMs: number
  words: LyricWord[]
}

/** A single word with its Whisper-returned timestamp pair [startSec, endSec]. */
export interface TimedWord {
  text: string
  timestamp: [number, number]
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Groups a flat array of word-level Whisper chunks into display lines.
 * Each line is at most `maxCharsPerLine` characters (default 40, per PRD).
 * Individual word timestamps are preserved in `LyricLine.words`.
 */
export function groupWordsIntoLines(
  chunks: TimedWord[],
  maxCharsPerLine = 40,
): LyricLine[] {
  const lines: LyricLine[] = []
  let buffer: TimedWord[] = []
  let bufferLen = 0

  const flush = () => {
    if (buffer.length === 0) return
    const first = buffer[0]
    const last = buffer[buffer.length - 1]
    lines.push({
      id: crypto.randomUUID(),
      text: buffer.map((w) => w.text.trim()).join(' '),
      startMs: Math.round(first.timestamp[0] * 1000),
      endMs: Math.round(last.timestamp[1] * 1000),
      words: buffer.map((w) => ({
        text: w.text.trim(),
        startMs: Math.round(w.timestamp[0] * 1000),
      })),
    })
    buffer = []
    bufferLen = 0
  }

  for (const chunk of chunks) {
    const word = chunk.text.trim()
    if (!word) continue

    const cost = bufferLen === 0 ? word.length : word.length + 1
    if (bufferLen + cost > maxCharsPerLine && buffer.length > 0) flush()

    buffer.push(chunk)
    bufferLen += cost
  }

  flush()
  return lines
}

/**
 * Binary-search for the index of the line that should be active at `currentMs`.
 * Returns -1 if before the first line.
 */
export function findActiveLineIdx(lines: LyricLine[], currentMs: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (lines[mid].startMs <= currentMs) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * Returns the index of the last word whose `startMs` ≤ `currentMs`,
 * i.e. the word that should be highlighted. Returns -1 if before first word.
 */
export function findActiveWordIdx(line: LyricLine, currentMs: number): number {
  const words = line.words
  if (!words.length) return -1
  let lo = 0
  let hi = words.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (words[mid].startMs <= currentMs) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
