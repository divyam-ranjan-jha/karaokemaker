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
      workerRef.current = new Worker(
        new URL('../workers/whisper.worker.ts', import.meta.url),
        { type: 'module' },
      )

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
      // Fetch audio on the main thread (same origin rules apply here, but the
      // browser's audio pipeline is more permissive than fetch() for CDN streams).
      const res = await fetch(pending.streamUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const arrayBuffer = await res.arrayBuffer()

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
    } catch (err) {
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
      const worker = getOrCreateWorker()
      worker.postMessage({ type: 'TRANSCRIBE_URL', streamUrl, durationSeconds })
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
