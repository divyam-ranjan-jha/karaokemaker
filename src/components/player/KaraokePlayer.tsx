/**
 * KaraokePlayer — PRD Section 6.4
 *
 * Layout (all fixed-position layers):
 *   ┌─ Header ──────────────────────────────────┐  fixed top
 *   │  scrollable lyrics (auto-centred on RAF)   │  flex-1
 *   └─ Controls bar ────────────────────────────┘  fixed bottom
 *
 * Performance contract:
 *   - RAF loop writes directly to DOM refs → 0 React re-renders at 60fps
 *   - activeLineIdx / activeWordIdx are React state → re-render only on change
 *   - LyricsArea is React.memo'd → skips diffing when progress ticks
 */

import React, {
  useRef, useState, useEffect, useCallback, memo,
} from 'react'
import {
  Play, Pause, RotateCcw, ChevronLeft, ChevronRight,
  Pencil, Share2, Mic2, Check, AlertTriangle,
} from 'lucide-react'
import { useKaraokeStore } from '@/store/useKaraokeStore'
import { proxyStreamUrl } from '@/services/youtube'
import {
  findActiveLineIdx, findActiveWordIdx,
} from '@/lib/lyrics'
import { formatTime } from '@/lib/format'
import { encodeStateToUrl, extractVideoId } from '@/lib/share'
import type { LyricLine } from '@/lib/lyrics'

// Share feedback status
type ShareStatus = 'idle' | 'copied' | 'oversized' | 'error'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const

// Number of empty screen-heights of padding so first/last lines can be centred.
// 45vh on each side works for most screen heights.
const LYRICS_PADDING = '45vh'

// ---------------------------------------------------------------------------
// Neon glow style for the active (highlighted) word
// ---------------------------------------------------------------------------

const NEON_STYLE: React.CSSProperties = {
  color: '#e879f9',           // fuchsia-400
  filter:
    'drop-shadow(0 0 6px #e879f9) drop-shadow(0 0 18px #a21caf)',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tailwind classes for lines based on their distance from the active line. */
function lineClasses(dist: number): string {
  if (dist === 0) return 'text-[1.9rem] sm:text-[2.4rem] leading-tight font-bold text-white transition-all duration-300'
  if (dist === 1) return 'text-xl sm:text-2xl font-medium text-white/50 transition-all duration-300'
  if (dist === -1) return 'text-lg sm:text-xl text-white/25 transition-all duration-300'
  if (Math.abs(dist) <= 2) return 'text-base sm:text-lg text-white/15 transition-all duration-300'
  return 'text-sm sm:text-base text-white/[0.06] transition-all duration-300'
}

// ---------------------------------------------------------------------------
// Memoised sub-components
// ---------------------------------------------------------------------------

interface LineItemProps {
  line: LyricLine
  dist: number          // idx - activeLineIdx
  activeWordIdx: number // only meaningful when dist === 0
  lineRef: (el: HTMLDivElement | null) => void
}

const LineItem = memo(function LineItem({ line, dist, activeWordIdx, lineRef }: LineItemProps) {
  const isActive = dist === 0
  const hasWordTimestamps = line.words.length > 0

  return (
    <div
      ref={lineRef}
      className={`text-center px-4 py-3 select-none ${lineClasses(dist)}`}
    >
      {isActive && hasWordTimestamps ? (
        // Word-by-word highlight for active line
        line.words.map((word, wi) => (
          <span
            key={wi}
            style={wi <= activeWordIdx ? NEON_STYLE : undefined}
            className="inline-block mx-[0.12em] transition-all duration-75"
          >
            {word.text}
          </span>
        ))
      ) : (
        // Single span for all other lines (or lines without word timestamps)
        <span>{line.text}</span>
      )}
    </div>
  )
})

interface LyricsAreaProps {
  lyrics: LyricLine[]
  activeLineIdx: number
  activeWordIdx: number
  containerRef: React.RefObject<HTMLDivElement | null>
  lineRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
}

const LyricsArea = memo(function LyricsArea({
  lyrics, activeLineIdx, activeWordIdx, containerRef, lineRefs,
}: LyricsAreaProps) {
  if (lyrics.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center text-white/30 text-lg"
      >
        No lyrics loaded — go back to the editor to add them.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ paddingTop: LYRICS_PADDING, paddingBottom: LYRICS_PADDING }}
    >
      {lyrics.map((line, idx) => (
        <LineItem
          key={line.id}
          line={line}
          dist={idx - activeLineIdx}
          activeWordIdx={activeWordIdx}
          lineRef={(el) => { lineRefs.current[idx] = el }}
        />
      ))}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KaraokePlayer() {
  // Store
  const streamUrl = useKaraokeStore((s) => s.streamUrl)
  const youtubeUrl = useKaraokeStore((s) => s.youtubeUrl)
  const title = useKaraokeStore((s) => s.title)
  const thumbnailUrl = useKaraokeStore((s) => s.thumbnailUrl)
  const storeDuration = useKaraokeStore((s) => s.duration)
  const lyrics = useKaraokeStore((s) => s.lyrics)
  const savedCurrentTime = useKaraokeStore((s) => s.currentTime)
  const setPlayback = useKaraokeStore((s) => s.setPlayback)
  const setView = useKaraokeStore((s) => s.setView)

  // ---------- Refs ----------

  // Audio
  const audioRef = useRef<HTMLAudioElement>(null)

  // RAF
  const rafIdRef = useRef<number>(0)
  const isPlayingRef = useRef(false)  // mirror of isPlaying, readable inside RAF cb

  // Stable copy of lyrics for RAF callback (avoids stale closure)
  const lyricsRef = useRef(lyrics)
  useEffect(() => { lyricsRef.current = lyrics }, [lyrics])

  // Stable duration for progress calculation
  const durationRef = useRef(storeDuration)

  // Active indices (prev values to detect changes inside RAF)
  const prevLineRef = useRef(-1)
  const prevWordRef = useRef(-1)

  // DOM refs for 60fps progress updates (no React state)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const progressThumbRef = useRef<HTMLDivElement>(null)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const totalTimeRef = useRef<HTMLSpanElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)

  // Lyrics layout
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  // ---------- React state (minimal — only for render-visible changes) ----------

  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [activeLineIdx, setActiveLineIdx] = useState(-1)
  const [activeWordIdx, setActiveWordIdx] = useState(-1)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [hasStartedOnce, setHasStartedOnce] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle')
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------------------------------------------------------------------------
  // Auto-scroll
  // ---------------------------------------------------------------------------

  const scrollToLine = useCallback((idx: number) => {
    const container = containerRef.current
    const line = lineRefs.current[idx]
    if (!container || !line) return
    const targetTop =
      line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }, [])

  // ---------------------------------------------------------------------------
  // RAF loop — updates DOM directly, state only on index changes
  // ---------------------------------------------------------------------------

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current)
  }, [])

  const startRaf = useCallback(() => {
    const tick = () => {
      const audio = audioRef.current
      if (!audio || !isPlayingRef.current) return

      const ms = audio.currentTime * 1000
      const dur = (isFinite(audio.duration) ? audio.duration : durationRef.current) * 1000

      // --- Progress bar (direct DOM, no React) ---
      const pct = dur > 0 ? Math.min(100, (ms / dur) * 100) : 0
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`
      if (currentTimeRef.current) currentTimeRef.current.textContent = formatTime(ms / 1000)
      if (rangeRef.current) rangeRef.current.value = String(ms / 1000)

      // --- Active line (React state only on change) ---
      const newLine = findActiveLineIdx(lyricsRef.current, ms)
      if (newLine !== prevLineRef.current) {
        prevLineRef.current = newLine
        setActiveLineIdx(newLine)
        scrollToLine(newLine)
      }

      // --- Active word (React state only on change) ---
      if (newLine >= 0) {
        const line = lyricsRef.current[newLine]
        const newWord = line ? findActiveWordIdx(line, ms) : -1
        if (newWord !== prevWordRef.current) {
          prevWordRef.current = newWord
          setActiveWordIdx(newWord)
        }
      }

      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)
  }, [scrollToLine])

  // ---------------------------------------------------------------------------
  // Audio event wiring
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // Restore saved position (for "return from editor" flow)
    if (savedCurrentTime > 0) audio.currentTime = savedCurrentTime

    const onCanPlay = () => {
      setIsReady(true)
      durationRef.current = audio.duration
      if (totalTimeRef.current) {
        totalTimeRef.current.textContent = formatTime(audio.duration)
      }
    }
    const onDurationChange = () => {
      durationRef.current = audio.duration
      if (totalTimeRef.current) {
        totalTimeRef.current.textContent = formatTime(audio.duration)
      }
    }
    const onPlay = () => {
      isPlayingRef.current = true
      setIsPlaying(true)
      startRaf()
    }
    const onPause = () => {
      isPlayingRef.current = false
      setIsPlaying(false)
      stopRaf()
      setPlayback({ currentTime: audio.currentTime, isPlaying: false })
    }
    const onEnded = () => {
      isPlayingRef.current = false
      setIsPlaying(false)
      stopRaf()
    }
    const onError = () => {
      setAudioError('Failed to load the audio stream. It may have expired — go back and try again.')
    }

    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      stopRaf()
      audio.pause()
      if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current)
    }
  }, [startRaf, stopRaf, setPlayback, savedCurrentTime])

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const doPlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !isReady) return
    try {
      await audio.play()
    } catch {
      // Autoplay policy — user must interact first (iOS Safari)
    }
  }, [isReady])

  const doPause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const seekBy = useCallback((deltaSec: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + deltaSec))
    // Immediately update progress DOM so it feels responsive
    const ms = audio.currentTime * 1000
    const dur = durationRef.current * 1000
    const pct = dur > 0 ? Math.min(100, (ms / dur) * 100) : 0
    if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`
    if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`
    if (currentTimeRef.current) currentTimeRef.current.textContent = formatTime(audio.currentTime)
    if (rangeRef.current) rangeRef.current.value = String(audio.currentTime)
  }, [])

  const restart = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setActiveLineIdx(-1)
    setActiveWordIdx(-1)
    prevLineRef.current = -1
    prevWordRef.current = -1
  }, [])

  const changeRate = useCallback((rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [])

  /** First play shows a 3-2-1 countdown; subsequent plays go straight. */
  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      doPause()
      return
    }
    if (!hasStartedOnce) {
      // Countdown sequence
      for (const n of [3, 2, 1] as const) {
        setCountdown(n)
        await new Promise<void>((res) => setTimeout(res, 900))
      }
      setCountdown(null)
      setHasStartedOnce(true)
    }
    await doPlay()
  }, [isPlaying, hasStartedOnce, doPlay, doPause])

  // Progress bar click → seek
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current
      if (!audio || !isFinite(audio.duration)) return
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      audio.currentTime = ratio * audio.duration
    },
    [],
  )

  // Navigate back to editor without losing position
  const goToEditor = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      setPlayback({ currentTime: audio.currentTime, isPlaying: false })
      audio.pause()
    }
    setView('editor')
  }, [setPlayback, setView])

  // Share — PRD §6.5
  const handleShare = useCallback(async () => {
    const videoId = extractVideoId(youtubeUrl)
    if (!videoId) return

    const result = encodeStateToUrl(videoId, lyrics)

    // Update the browser URL bar so a refresh re-opens the share link.
    window.history.replaceState(null, '', result.url)

    // Clear any previous timeout
    if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current)

    try {
      await navigator.clipboard.writeText(result.url)
      setShareStatus(result.oversized ? 'oversized' : 'copied')
    } catch {
      // Clipboard blocked (non-HTTPS or permission denied)
      setShareStatus('error')
    }

    // Auto-reset feedback after 4 s
    shareTimeoutRef.current = setTimeout(() => setShareStatus('idle'), 4000)
  }, [youtubeUrl, lyrics])

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when user is typing
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seekBy(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seekBy(5)
          break
        case 'KeyR':
          e.preventDefault()
          restart()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, restart])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Initialise total time display once duration is known from store
  useEffect(() => {
    if (storeDuration > 0 && totalTimeRef.current) {
      totalTimeRef.current.textContent = formatTime(storeDuration)
    }
  }, [storeDuration])

  return (
    <div className="relative flex flex-col min-h-screen bg-[#050508] text-white overflow-hidden">
      {/* Hidden audio */}
      <audio
        ref={audioRef}
        src={proxyStreamUrl(streamUrl)}
        preload="auto"
        crossOrigin="anonymous"
        className="hidden"
      />

      {/* ── Background ambient glow ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <div className="w-[80vw] h-[80vw] max-w-2xl max-h-2xl rounded-full bg-fuchsia-900/10 blur-[140px]" />
      </div>

      {/* ── Countdown overlay ── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <span
            key={countdown}
            className="text-[10rem] font-black text-white leading-none"
            style={{
              animation: 'countdown-pop 0.9s ease-out forwards',
              textShadow: '0 0 40px #e879f9, 0 0 100px #a21caf',
            }}
          >
            {countdown}
          </span>
          <style>{`
            @keyframes countdown-pop {
              0%   { transform: scale(1.6); opacity: 0; }
              20%  { transform: scale(1);   opacity: 1; }
              75%  { transform: scale(1);   opacity: 1; }
              100% { transform: scale(0.7); opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* ── Header ── */}
      <header className="relative z-10 flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-[#050508]/80 backdrop-blur-md shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={title} className="w-9 h-9 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
            <Mic2 className="w-4 h-4 text-violet-400" />
          </div>
        )}
        <p className="text-sm font-medium text-white/80 truncate flex-1 min-w-0">{title}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goToEditor}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-all"
            aria-label="Edit lyrics"
            title="Edit lyrics"
          >
            <Pencil className="w-3 h-3" />
            <span className="hidden sm:inline">Edit lyrics</span>
          </button>

          {/* Share button with copy feedback */}
          <div className="relative">
            <button
              onClick={handleShare}
              disabled={!youtubeUrl}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all',
                shareStatus === 'copied'
                  ? 'text-green-400 bg-green-500/10'
                  : shareStatus === 'oversized'
                    ? 'text-amber-400 bg-amber-500/10'
                    : shareStatus === 'error'
                      ? 'text-red-400 bg-red-500/10'
                      : 'text-white/50 hover:text-white hover:bg-white/5',
                !youtubeUrl ? 'opacity-30 cursor-not-allowed' : '',
              ].join(' ')}
              aria-label="Share karaoke link"
            >
              {shareStatus === 'copied' || shareStatus === 'oversized' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {shareStatus === 'copied' ? 'Copied!'
                  : shareStatus === 'oversized' ? 'Copied!'
                  : shareStatus === 'error' ? 'Failed'
                  : 'Share'}
              </span>
            </button>

            {/* Oversized warning tooltip */}
            {shareStatus === 'oversized' && (
              <div className="absolute right-0 top-full mt-2 w-56 sm:w-60 z-50 rounded-xl bg-[#1a1020] border border-amber-500/30 p-3 shadow-xl shadow-black/40">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 text-xs font-medium">URL is large (&gt; 4 KB)</p>
                    <p className="text-white/40 text-xs mt-0.5 leading-relaxed">
                      This link may not work in all browsers. Consider shortening the lyrics in the editor.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Clipboard blocked tooltip */}
            {shareStatus === 'error' && (
              <div className="absolute right-0 top-full mt-2 w-56 z-50 rounded-xl bg-[#1a1020] border border-red-500/30 p-3 shadow-xl shadow-black/40">
                <p className="text-red-300 text-xs font-medium">Clipboard blocked</p>
                <p className="text-white/40 text-xs mt-1 break-all select-all">
                  {window.location.href}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Lyrics area ── */}
      {audioError ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center space-y-3 max-w-sm">
            <p className="text-white/60">{audioError}</p>
            <button
              onClick={() => setView('home')}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
            >
              ← Back to home
            </button>
          </div>
        </div>
      ) : (
        <LyricsArea
          lyrics={lyrics}
          activeLineIdx={activeLineIdx}
          activeWordIdx={activeWordIdx}
          containerRef={containerRef}
          lineRefs={lineRefs}
        />
      )}

      {/* ── Controls bar ── */}
      <div
        className="relative z-10 shrink-0 border-t border-white/5 bg-[#050508]/90 backdrop-blur-md px-4 pt-3 space-y-3"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <span ref={currentTimeRef} className="text-xs text-white/40 tabular-nums w-10 text-right shrink-0">
            0:00
          </span>

          {/* Track */}
          <div
            className="relative flex-1 h-1 bg-white/10 rounded-full cursor-pointer group"
            onClick={handleProgressClick}
          >
            {/* Fill */}
            <div
              ref={progressFillRef}
              className="absolute inset-y-0 left-0 w-0 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full pointer-events-none"
            />
            {/* Thumb */}
            <div
              ref={progressThumbRef}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-0 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            />
            {/* Invisible range for accessibility */}
            <input
              ref={rangeRef}
              type="range"
              min={0}
              max={storeDuration || 100}
              step={0.1}
              defaultValue={0}
              onInput={(e) => {
                const audio = audioRef.current
                if (audio) audio.currentTime = parseFloat(e.currentTarget.value)
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek"
            />
          </div>

          <span ref={totalTimeRef} className="text-xs text-white/40 tabular-nums w-10 shrink-0">
            {formatTime(storeDuration)}
          </span>
        </div>

        {/* Playback buttons */}
        <div className="flex items-center justify-between">

          {/* Left: restart + seek back */}
          <div className="flex items-center gap-1">
            <button
              onClick={restart}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all"
              aria-label="Restart"
              title="Restart (R)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => seekBy(-5)}
              className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/5 transition-all"
              aria-label="Back 5 seconds"
              title="Back 5s (←)"
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="sr-only">−5s</span>
            </button>
          </div>

          {/* Centre: play/pause */}
          <button
            onClick={togglePlay}
            disabled={!isReady && !audioError}
            className={[
              'flex items-center justify-center w-14 h-14 rounded-full transition-all',
              isReady || audioError
                ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-105 active:scale-95'
                : 'bg-white/10 text-white/20 cursor-not-allowed',
            ].join(' ')}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title="Play / Pause (Space)"
          >
            {isPlaying
              ? <Pause className="w-6 h-6 fill-white" />
              : <Play className="w-6 h-6 fill-white translate-x-0.5" />}
          </button>

          {/* Right: seek forward + speed */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => seekBy(5)}
              className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/5 transition-all"
              aria-label="Forward 5 seconds"
              title="Forward 5s (→)"
            >
              <ChevronRight className="w-5 h-5" />
              <span className="sr-only">+5s</span>
            </button>
            {/* Speed control */}
            <select
              value={playbackRate}
              onChange={(e) => changeRate(Number(e.target.value))}
              className="bg-white/5 border border-white/10 text-white/70 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer hover:bg-white/10 transition-all appearance-none"
              aria-label="Playback speed"
            >
              {SPEED_OPTIONS.map((r) => (
                <option key={r} value={r} className="bg-[#1a1a2e]">
                  {r === 1 ? '1×' : `${r}×`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Keyboard hint — desktop only */}
        <p className="hidden sm:block text-center text-white/15 text-[10px] tracking-wide">
          Space · ← / → seek · R restart
        </p>
      </div>
    </div>
  )
}
