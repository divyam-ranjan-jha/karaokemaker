import { create } from 'zustand'
import type { LyricLine } from '@/lib/lyrics'

export type { LyricLine } from '@/lib/lyrics'

export type AppView = 'home' | 'player' | 'editor'

// ---------------------------------------------------------------------------
// State slices
// ---------------------------------------------------------------------------

interface MetaState {
  youtubeUrl: string
  streamUrl: string
  title: string
  thumbnailUrl: string | null
  duration: number // seconds
}

interface PlaybackState {
  isPlaying: boolean
  currentTime: number
  playbackRate: number // 0.25 – 1.5
  isReady: boolean
}

interface LyricsState {
  lyrics: LyricLine[]
  isTranscribing: boolean
  transcriptionProgress: number // 0–100
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface Actions {
  setMeta: (data: Partial<MetaState>) => void
  setPlayback: (data: Partial<PlaybackState>) => void
  setLyrics: (lyrics: LyricLine[]) => void
  updateLyricTiming: (id: string, newStartMs: number) => void
  /** Update transcription loading state (progress, isTranscribing flag). */
  setTranscription: (data: Partial<LyricsState>) => void
  setView: (view: AppView) => void
  resetStore: () => void
}

// ---------------------------------------------------------------------------
// Full store type
// ---------------------------------------------------------------------------

type KaraokeStore = MetaState & PlaybackState & LyricsState & { view: AppView } & Actions

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialMeta: MetaState = {
  youtubeUrl: '',
  streamUrl: '',
  title: '',
  thumbnailUrl: null,
  duration: 0,
}

const initialPlayback: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  playbackRate: 1,
  isReady: false,
}

const initialLyrics: LyricsState = {
  lyrics: [],
  isTranscribing: false,
  transcriptionProgress: 0,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useKaraokeStore = create<KaraokeStore>((set) => ({
  ...initialMeta,
  ...initialPlayback,
  ...initialLyrics,
  view: 'home',

  setMeta: (data) => set((s) => ({ ...s, ...data })),

  setPlayback: (data) => set((s) => ({ ...s, ...data })),

  setLyrics: (lyrics) => set({ lyrics }),

  updateLyricTiming: (id, newStartMs) =>
    set((s) => ({
      lyrics: s.lyrics.map((line) =>
        line.id === id ? { ...line, startMs: newStartMs } : line,
      ),
    })),

  setTranscription: (data) => set((s) => ({ ...s, ...data })),

  setView: (view) => set({ view }),

  resetStore: () =>
    set({ ...initialMeta, ...initialPlayback, ...initialLyrics, view: 'home' }),
}))
