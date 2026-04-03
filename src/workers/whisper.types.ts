/**
 * Discriminated union messages exchanged between the Whisper worker
 * and the main thread. Import this file for type safety on both sides.
 */

import type { LyricLine } from '@/lib/lyrics'

// ---------------------------------------------------------------------------
// Main → Worker
// ---------------------------------------------------------------------------

/** Start transcription from a remote audio stream URL. */
export interface TranscribeUrlCmd {
  type: 'TRANSCRIBE_URL'
  streamUrl: string
  /** Total audio duration in seconds — used for progress estimation. */
  durationSeconds: number
}

/**
 * Start transcription from raw PCM audio (Float32Array at 16 kHz mono).
 * Sent by the main thread if the URL approach fails due to CORS.
 */
export interface TranscribePcmCmd {
  type: 'TRANSCRIBE_PCM'
  /** Transferred ArrayBuffer backing a Float32Array (16 kHz mono). */
  pcmBuffer: ArrayBuffer
}

export type WorkerCommand = TranscribeUrlCmd | TranscribePcmCmd

// ---------------------------------------------------------------------------
// Worker → Main
// ---------------------------------------------------------------------------

/** Whisper model is downloading from CDN. */
export interface ModelLoadingMsg {
  type: 'MODEL_LOADING'
  /** 0–100 download progress. */
  progress: number
  /** Human-readable label, e.g. "Downloading AI model (12 MB / 39 MB)". */
  label: string
}

/** Audio is actively being transcribed. */
export interface TranscribingMsg {
  type: 'TRANSCRIBING'
  /** 0–100 transcription progress. */
  progress: number
}

/** Transcription finished successfully. */
export interface CompleteMsg {
  type: 'COMPLETE'
  lyrics: LyricLine[]
}

/**
 * The URL-based fetch failed (most likely CORS).
 * Main thread should decode audio to PCM and reply with TRANSCRIBE_PCM.
 */
export interface NeedPcmMsg {
  type: 'NEED_PCM'
}

/** Unrecoverable error. */
export interface ErrorMsg {
  type: 'ERROR'
  message: string
  /** Hints whether the user can retry (e.g. transient network vs unsupported browser). */
  retryable: boolean
}

export type WorkerMessage =
  | ModelLoadingMsg
  | TranscribingMsg
  | CompleteMsg
  | NeedPcmMsg
  | ErrorMsg
