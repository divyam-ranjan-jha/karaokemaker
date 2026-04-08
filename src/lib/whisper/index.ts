/**
 * Whisper WASM transcription stub.
 * Swap the implementation body when integrating a real WASM whisper package.
 */

import type { WhisperOptions, WhisperResult } from './types'

export type { WhisperOptions, WhisperResult, WhisperSegment } from './types'

export async function transcribeAudio(
  _audioBuffer: AudioBuffer,
  options: WhisperOptions = {},
): Promise<WhisperResult> {
  void options
  // TODO: integrate real WASM whisper package here
  throw new Error(
    'Whisper WASM is not yet integrated. Replace this stub with a real implementation.',
  )
}

export async function loadWhisperModel(
  modelSize: WhisperOptions['modelSize'] = 'base',
  onProgress?: (progress: number) => void,
): Promise<void> {
  void modelSize
  void onProgress
  // TODO: pre-load and cache the WASM model
  throw new Error('Whisper model loading is not yet implemented.')
}
