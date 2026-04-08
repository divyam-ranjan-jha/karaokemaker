/**
 * Whisper Web Worker
 *
 * Runs @xenova/transformers (whisper-tiny) entirely off the main thread.
 * The model (~39 MB) is cached in the browser Cache API after first load.
 *
 * Message protocol is defined in ./whisper.types.ts.
 */

import { pipeline, env } from '@xenova/transformers'
import { groupWordsIntoLines } from '@/lib/lyrics'
import type { WorkerCommand, WorkerMessage } from './whisper.types'
import type { LyricLine, TimedWord } from '@/lib/lyrics'

// ---------------------------------------------------------------------------
// @xenova/transformers configuration
// ---------------------------------------------------------------------------

// Models are cached in the browser's Cache API (CacheStorage API).
env.allowLocalModels = false
env.useBrowserCache = true

// Single-threaded WASM avoids the need for SharedArrayBuffer
// (which requires COOP/COEP headers). Slightly slower but universally supported.
// Remove this line if you add COOP/COEP headers to the server — then ONNX can
// use SIMD + multi-threaded WASM, cutting transcription time ~3×.
env.backends.onnx.wasm.numThreads = 1

const MODEL_ID = 'Xenova/whisper-tiny'

// ---------------------------------------------------------------------------
// Singleton pipeline — reused across multiple transcriptions
// ---------------------------------------------------------------------------

type ASRPipeline = Awaited<ReturnType<typeof pipeline>>
let asr: ASRPipeline | null = null

async function loadModel(): Promise<ASRPipeline> {
  if (asr) return asr

  let lastFile = ''
  let totalBytes = 0
  let loadedBytes = 0

  asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: (info: {
      status: string
      file?: string
      loaded?: number
      total?: number
      progress?: number
    }) => {
      if (info.status === 'initiate') {
        lastFile = info.file ?? ''
        return
      }

      if (info.status === 'progress') {
        loadedBytes = info.loaded ?? 0
        totalBytes = info.total ?? 0
        const pct = totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : (info.progress ?? 0)
        const loadedMB = (loadedBytes / 1_048_576).toFixed(1)
        const totalMB = (totalBytes / 1_048_576).toFixed(1)

        const msg: WorkerMessage = {
          type: 'MODEL_LOADING',
          progress: Math.round(pct),
          label:
            totalBytes > 0
              ? `Downloading AI model (${loadedMB} MB / ${totalMB} MB)`
              : `Loading ${lastFile}…`,
        }
        self.postMessage(msg)
      }
    },
  })

  return asr
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

async function transcribeAudio(
  audioInput: string | Float32Array,
  durationSeconds: number,
): Promise<LyricLine[]> {
  const pipe = await loadModel()

  // Simulate smooth progress during transcription.
  // @xenova/transformers does not expose per-chunk progress for ASR pipelines,
  // so we use an asymptotic approach: progress converges toward 95% then
  // jumps to 100 on completion. If we know durationSeconds we weight it.
  let simulatedPct = 0
  const estimatedStepMs = durationSeconds > 0
    ? Math.max(300, (durationSeconds * 1000) / 60) // ~60 steps for full song
    : 400

  const progressTimer = setInterval(() => {
    // Easing: each tick covers (95 - current) * 0.12 of the remaining gap
    simulatedPct = simulatedPct + (95 - simulatedPct) * 0.12
    const msg: WorkerMessage = { type: 'TRANSCRIBING', progress: Math.round(simulatedPct) }
    self.postMessage(msg)
  }, estimatedStepMs)

  let result: { chunks?: { text: string; timestamp: [number, number] }[] }

  try {
    result = await (pipe as (
      input: string | Float32Array,
      options: Record<string, unknown>,
    ) => Promise<{ chunks?: { text: string; timestamp: [number, number] }[] }>)(audioInput, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      force_full_sequences: false,
      language: 'english', // auto-detected if omitted — include to speed up tiny model
    })
  } finally {
    clearInterval(progressTimer)
  }

  const rawChunks = result.chunks ?? []

  // Cast to TimedWord so groupWordsIntoLines gets the right shape
  const words: TimedWord[] = rawChunks.map((c) => ({
    text: c.text,
    timestamp: c.timestamp,
  }))

  return groupWordsIntoLines(words)
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data

  try {
    if (cmd.type === 'TRANSCRIBE_URL') {
      const audioInput: string | Float32Array = cmd.streamUrl

      try {
        // Try transcribing from the URL directly.
        // If the YouTube CDN URL has CORS headers, this works in one shot.
        const lyrics = await transcribeAudio(audioInput, cmd.durationSeconds)
        const msg: WorkerMessage = { type: 'COMPLETE', lyrics }
        self.postMessage(msg)
      } catch (urlErr: unknown) {
        const message = urlErr instanceof Error ? urlErr.message : String(urlErr)

        // Detect CORS / network errors and ask main thread to send PCM instead.
        const isCorsLike =
          message.includes('Failed to fetch') ||
          message.includes('NetworkError') ||
          message.includes('CORS') ||
          message.includes('cross-origin')

        if (isCorsLike) {
          const msg: WorkerMessage = { type: 'NEED_PCM' }
          self.postMessage(msg)
        } else {
          throw urlErr
        }
      }
    } else if (cmd.type === 'TRANSCRIBE_PCM') {
      // Main thread decoded audio to PCM and transferred the ArrayBuffer.
      const pcm = new Float32Array(cmd.pcmBuffer)
      const lyrics = await transcribeAudio(pcm, pcm.length / 16_000)
      const msg: WorkerMessage = { type: 'COMPLETE', lyrics }
      self.postMessage(msg)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown transcription error'
    const isWasmUnsupported =
      message.includes('WebAssembly') || message.includes('wasm')
    const msg: WorkerMessage = {
      type: 'ERROR',
      message: isWasmUnsupported
        ? 'Your browser does not support WebAssembly. Please use Chrome, Firefox, or Safari 15+.'
        : `Transcription failed: ${message}`,
      retryable: !isWasmUnsupported,
    }
    self.postMessage(msg)
  }
}
