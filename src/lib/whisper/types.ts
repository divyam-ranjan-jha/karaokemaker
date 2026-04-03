/**
 * Placeholder types for Whisper WASM transcription integration.
 * Replace with real implementation once a WASM whisper package is chosen
 * (e.g. @xenova/transformers, whisper.cpp WASM build, etc.)
 */

export interface WhisperSegment {
  start: number   // seconds
  end: number     // seconds
  text: string
}

export interface WhisperResult {
  segments: WhisperSegment[]
  language: string
  duration: number
}

export interface WhisperOptions {
  language?: string       // e.g. 'en', 'auto'
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large'
  onProgress?: (progress: number) => void
}
