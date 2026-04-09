/**
 * useWhisper — manages the Whisper web worker lifecycle.
 *
 * Usage:
 *   const { transcribe, cancel, isSupported } = useWhisper({ onModelLoading, onTranscribing, onComplete, onError })
 *
 * The worker is created lazily on first call to `transcribe()` and
 * terminated on component unmount (or when `cancel()` is called).
 */

import { useRef, useEffect, useCallback } from 'react'
import type { WorkerMessage } from '@/workers/whisper.types'
import type { LyricLine } from '@/lib/lyrics'

// Vite's `?worker` suffix forces bundling even in dev mode,
// which resolves @xenova/transformers' circular ort-web init.
import WhisperWorkerClass from '@/workers/whisper.worker.ts?worker'
import { proxyStreamUrl } from '@/services/youtube'

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface WhisperCallbacks {
  /** Called while the Whisper model is downloading. progress = 0–100. */
  onModelLoading?: (progress: number, label: string) => void
  /** Called during audio transcription. progress = 0–100. */
  onTranscribing?: (progress: number) => void
  /** Called when transcription finishes successfully. */
  onComplete?: (lyrics: LyricLine[]) => void
  /**
   * Called on any unrecoverable error.
   * retryable = true means user can try again; false means browser is unsupported.
   */
  onError?: (message: string, retryable: boolean) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWhisper(callbacks: WhisperCallbacks) {
  const workerRef = useRef<Worker | null>(null)
  // Keep a stable ref to the latest callbacks so the message handler
  // always sees current values without re-creating the worker.
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  /** Whether WebAssembly is available in this browser. */
  const isSupported = typeof WebAssembly !== 'undefined'

  function getOrCreateWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new WhisperWorkerClass()

      workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data
        const cb = callbacksRef.current

        switch (msg.type) {
          case 'MODEL_LOADING':
            cb.onModelLoading?.(msg.progress, msg.label)
            break

          case 'TRANSCRIBING':
            cb.onTranscribing?.(msg.progress)
            break

          case 'COMPLETE':
            cb.onComplete?.(msg.lyrics)
            break

          case 'NEED_PCM':
            // Worker couldn't fetch the URL (CORS). Fall back to main-thread PCM decode.
            handlePcmFallback()
            break

          case 'ERROR':
            cb.onError?.(msg.message, msg.retryable)
            break
        }
      }

      workerRef.current.onerror = (e) => {
        callbacksRef.current.onError?.(
          `Worker crashed: ${e.message}`,
          false,
        )
      }
    }
    return workerRef.current
  }

  // Stored so the PCM fallback can access the stream URL mid-session.
  const pendingUrlRef = useRef<{ streamUrl: string; durationSeconds: number } | null>(null)

  async function handlePcmFallback() {
    const pending = pendingUrlRef.current
    if (!pending) return

    try {
      const audioUrl = proxyStreamUrl(pending.streamUrl)

      callbacksRef.current.onModelLoading?.(100, 'Downloading audio…')

      const res = await fetch(audioUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Stream-read with progress if Content-Length is known
      const contentLength = Number(res.headers.get('content-length') || 0)
      let arrayBuffer: ArrayBuffer
      if (contentLength > 0 && res.body) {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          const pct = Math.round((received / contentLength) * 100)
          const mb = (received / 1_048_576).toFixed(1)
          const totalMb = (contentLength / 1_048_576).toFixed(1)
          callbacksRef.current.onModelLoading?.(100, `Downloading audio (${mb} / ${totalMb} MB)`)
          // Fake overall progress: model done (50%) + audio download (next 10%)
          callbacksRef.current.onTranscribing?.(pct * 0.2) // 0-20% of transcription phase
        }
        const full = new Uint8Array(received)
        let offset = 0
        for (const chunk of chunks) { full.set(chunk, offset); offset += chunk.length }
        arrayBuffer = full.buffer as ArrayBuffer
      } else {
        arrayBuffer = await res.arrayBuffer()
      }

      callbacksRef.current.onModelLoading?.(100, 'Decoding audio…')

      // Decode to 16 kHz mono Float32Array (Whisper's required input format).
      const audioCtx = new AudioContext({ sampleRate: 16_000 })
      const decoded = await audioCtx.decodeAudioData(arrayBuffer)
      await audioCtx.close()

      // Mix down to mono by using channel 0.
      const pcm = decoded.getChannelData(0)
      // Transfer the underlying ArrayBuffer to avoid a copy into the worker.
      const pcmBuffer = pcm.buffer.slice(0) as ArrayBuffer

      const worker = workerRef.current
      if (!worker) return

      worker.postMessage(
        { type: 'TRANSCRIBE_PCM', pcmBuffer },
        [pcmBuffer], // transfer ownership
      )
    } catch {
      callbacksRef.current.onError?.(
        'Could not decode audio for transcription. You can paste your own lyrics instead.',
        false,
      )
    }
  }

  /** Begin transcribing the audio at `streamUrl`. */
  const transcribe = useCallback(
    (streamUrl: string, durationSeconds: number) => {
      if (!isSupported) {
        callbacksRef.current.onError?.(
          'Your browser does not support WebAssembly. Please use Chrome 90+, Firefox 90+, or Safari 15+.',
          false,
        )
        return
      }

      pendingUrlRef.current = { streamUrl, durationSeconds }

      // Start model download in the worker immediately (runs in parallel with audio fetch)
      const worker = getOrCreateWorker()
      worker.postMessage({ type: 'LOAD_MODEL' })

      // Decode audio on the main thread (workers lack AudioContext)
      // then send raw PCM to the worker. Runs in parallel with model download.
      handlePcmFallback()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSupported],
  )

  /** Terminate the worker immediately (e.g. user navigates away). */
  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    pendingUrlRef.current = null
  }, [])

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  return { transcribe, cancel, isSupported }
}
