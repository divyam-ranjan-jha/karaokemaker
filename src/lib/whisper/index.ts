/**
 * Whisper WASM transcription stub.
 * Swap the implementation body when integrating a real WASM whisper package.
 */

import type { WhisperOptions, WhisperResult } from './types'

export type { WhisperOptions, WhisperResult, WhisperSegment } from './types'

export async function transcribeAudio(
  _audioBuffer: AudioBuffer,
  _options: WhisperOptions = {},
): Promise<WhisperResult> {
  // TODO: integrate real WASM whisper package here
  throw new Error(
    'Whisper WASM is not yet integrated. Replace this stub with a real implementation.',
  )
}

export async function loadWhisperModel(
  _modelSize: WhisperOptions['modelSize'] = 'base',
  _onProgress?: (progress: number) => void,
): Promise<void> {
  // TODO: pre-load and cache the WASM model
  throw new Error('Whisper model loading is not yet implemented.')
}
