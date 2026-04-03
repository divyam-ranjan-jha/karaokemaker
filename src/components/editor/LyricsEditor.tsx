/**
 * LyricsEditor — PRD Section 6.3
 *
 * Edits a local copy of the lyrics. Changes are committed to Zustand only
 * on "Save & Sing". This keeps undo/redo self-contained and lets the user
 * discard edits by navigating away.
 *
 * Panels:
 *  1. Fixed header   — back · undo/redo · re-sync toggle · Save & Sing
 *  2. Scrollable list — paste section · empty state · line rows
 *  3. Fixed footer   — mini audio player (re-sync mode only)
 */

import {
  useState, useEffect, useRef, useCallback, memo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  ArrowLeft, Undo2, Redo2, Radio, ClipboardPaste,
  Plus, Trash2, Play, Pause, Mic2, Music2, ChevronRight,
} from 'lucide-react'
import { useKaraokeStore } from '@/store/useKaraokeStore'
import type { LyricLine } from '@/lib/lyrics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** M:SS.d — decisecond precision for timestamp badges */
function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '0:00.0'
  const d = Math.floor(ms / 100) % 10
  const s = Math.floor(ms / 1000) % 60
  const m = Math.floor(ms / 60000)
  return `${m}:${s.toString().padStart(2, '0')}.${d}`
}

/** M:SS — for the mini audio player display */
function formatSec(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec) % 60
  const m = Math.floor(sec / 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Parse a pasted block of plain text into LyricLine[].
 * Timestamps are evenly distributed across the song duration.
 */
function parsePastedLyrics(raw: string, durationMs: number): LyricLine[] {
  const texts = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (texts.length === 0) return []

  const step = durationMs / texts.length
  return texts.map((text, i) => ({
    id: crypto.randomUUID(),
    text,
    startMs: Math.round(i * step),
    endMs: Math.round((i + 1) * step),
    words: [],           // no word-level timestamps for pasted lyrics
  }))
}

// ---------------------------------------------------------------------------
// Undo / redo hook
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50

function useHistory(initial: LyricLine[]) {
  const [lines, setLines] = useState<LyricLine[]>(initial)
  const historyRef = useRef<LyricLine[][]>([])
  const futureRef = useRef<LyricLine[][]>([])
  // Expose canUndo/canRedo as state so buttons re-render correctly
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const commit = useCallback((next: LyricLine[]) => {
    historyRef.current = [...historyRef.current.slice(-MAX_HISTORY + 1), lines]
    futureRef.current = []
    setLines(next)
    setCanUndo(true)
    setCanRedo(false)
  }, [lines])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    const prev = historyRef.current[historyRef.current.length - 1]
    futureRef.current = [lines, ...futureRef.current]
    historyRef.current = historyRef.current.slice(0, -1)
    setLines(prev)
    setCanUndo(historyRef.current.length > 0)
    setCanRedo(true)
  }, [lines])

  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    const next = futureRef.current[0]
    historyRef.current = [...historyRef.current, lines]
    futureRef.current = futureRef.current.slice(1)
    setLines(next)
    setCanUndo(true)
    setCanRedo(futureRef.current.length > 0)
  }, [lines])

  return { lines, commit, undo, redo, canUndo, canRedo }
}

// ---------------------------------------------------------------------------
// LineRow — memoised to avoid full-list re-renders on every keystroke
// ---------------------------------------------------------------------------

interface LineRowProps {
  line: LyricLine
  index: number
  isSyncFocused: boolean          // highlighted as the "next to sync" line
  isResyncing: boolean
  inputRef: (el: HTMLInputElement | null) => void
  onTextBlur: (index: number, text: string) => void
  onDelete: (index: number) => void
  onAddAfter: (index: number) => void
  onFocus: (index: number) => void
}

const LineRow = memo(function LineRow({
  line, index, isSyncFocused, isResyncing,
  inputRef, onTextBlur, onDelete, onAddAfter, onFocus,
}: LineRowProps) {
  const [localText, setLocalText] = useState(line.text)

  // Keep local text in sync when the underlying line changes externally
  // (e.g. undo/redo, paste) — but not while the user is actively typing
  const hasFocusRef = useRef(false)
  useEffect(() => {
    if (!hasFocusRef.current) setLocalText(line.text)
  }, [line.text])

  return (
    <div
      className={[
        'group flex items-center gap-3 px-4 py-2 border-b border-white/5 transition-colors',
        isSyncFocused
          ? 'bg-violet-500/10 border-l-2 border-l-violet-500'
          : 'hover:bg-white/[0.02]',
      ].join(' ')}
    >
      {/* Sync indicator arrow */}
      {isResyncing && (
        <ChevronRight
          className={[
            'w-4 h-4 shrink-0 transition-colors',
            isSyncFocused ? 'text-violet-400' : 'text-transparent',
          ].join(' ')}
        />
      )}

      {/* Timestamp badge */}
      <span
        className={[
          'font-mono text-xs shrink-0 w-14 text-right tabular-nums transition-colors',
          isSyncFocused ? 'text-violet-400' : 'text-white/30',
        ].join(' ')}
        title={`Start: ${line.startMs} ms`}
      >
        {formatMs(line.startMs)}
      </span>

      {/* Editable text */}
      <input
        ref={inputRef}
        type="text"
        value={localText}
        disabled={isResyncing}
        onChange={(e) => setLocalText(e.target.value)}
        onFocus={() => {
          hasFocusRef.current = true
          onFocus(index)
        }}
        onBlur={(e) => {
          hasFocusRef.current = false
          onTextBlur(index, e.target.value)
        }}
        onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
          // Tab → move to next input (browser default handles this)
          if (e.key === 'Enter' && !isResyncing) {
            e.preventDefault()
            onAddAfter(index)
          }
        }}
        placeholder="Lyric line…"
        className={[
          'flex-1 min-w-0 bg-transparent text-white placeholder:text-white/20',
          'text-sm focus:outline-none',
          isResyncing ? 'cursor-default' : '',
        ].join(' ')}
        spellCheck={false}
      />

      {/* Row actions — visible on hover (or always when not in re-sync) */}
      {!isResyncing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => onAddAfter(index)}
            className="p-1 rounded text-white/30 hover:text-violet-400 hover:bg-violet-500/10 transition-all"
            aria-label="Add line below"
            title="Add line below"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(index)}
            className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
            aria-label="Delete line"
            title="Delete line"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LyricsEditor() {
  // Store
  const storeLyrics = useKaraokeStore((s) => s.lyrics)
  const streamUrl = useKaraokeStore((s) => s.streamUrl)
  const title = useKaraokeStore((s) => s.title)
  const duration = useKaraokeStore((s) => s.duration)
  const savedCurrentTime = useKaraokeStore((s) => s.currentTime)
  const setLyrics = useKaraokeStore((s) => s.setLyrics)
  const setView = useKaraokeStore((s) => s.setView)
  const setPlayback = useKaraokeStore((s) => s.setPlayback)

  // History-backed local lines
  const { lines, commit, undo, redo, canUndo, canRedo } = useHistory(storeLyrics)

  // Re-sync state
  const [isResyncing, setIsResyncing] = useState(false)
  const [syncIdx, setSyncIdx] = useState(0)
  const [syncCurrentMs, setSyncCurrentMs] = useState(0)
  const [syncIsPlaying, setSyncIsPlaying] = useState(false)

  // Paste section
  const [showPaste, setShowPaste] = useState(storeLyrics.length === 0)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep inputRefs array sized correctly
  inputRefs.current = Array(lines.length).fill(null)

  // ---------------------------------------------------------------------------
  // Audio initialisation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (savedCurrentTime > 0) audio.currentTime = savedCurrentTime
  }, [savedCurrentTime])

  // ---------------------------------------------------------------------------
  // Line mutation helpers
  // ---------------------------------------------------------------------------

  const handleTextBlur = useCallback(
    (idx: number, text: string) => {
      if (text === lines[idx]?.text) return   // no change — skip history push
      commit(
        lines.map((l, i) =>
          i === idx ? { ...l, text: text.trim() || l.text } : l,
        ),
      )
    },
    [lines, commit],
  )

  const handleDelete = useCallback(
    (idx: number) => {
      if (lines.length <= 1) return
      commit(lines.filter((_, i) => i !== idx))
    },
    [lines, commit],
  )

  const handleAddAfter = useCallback(
    (idx: number) => {
      const before = lines[idx]
      const after = lines[idx + 1]
      const newStartMs = after
        ? Math.round((before.endMs + after.startMs) / 2)
        : before.endMs

      const newLine: LyricLine = {
        id: crypto.randomUUID(),
        text: '',
        startMs: newStartMs,
        endMs: after ? after.startMs : newStartMs + 3000,
        words: [],
      }

      const next = [...lines]
      next.splice(idx + 1, 0, newLine)
      commit(next)

      // Focus the new input on next tick
      setTimeout(() => inputRefs.current[idx + 1]?.focus(), 0)
    },
    [lines, commit],
  )

  // ---------------------------------------------------------------------------
  // Paste lyrics
  // ---------------------------------------------------------------------------

  const applyPaste = useCallback(() => {
    const text = pasteText.trim()
    if (!text) {
      setPasteError('Please paste some lyrics first.')
      return
    }
    const durationMs = (duration || 180) * 1000  // fallback to 3 min if unknown
    const parsed = parsePastedLyrics(text, durationMs)
    if (!parsed.length) {
      setPasteError('No lines found — make sure each line of lyrics is on its own line.')
      return
    }
    commit(parsed)
    setPasteText('')
    setPasteError(null)
    setShowPaste(false)
  }, [pasteText, duration, commit])

  // ---------------------------------------------------------------------------
  // Re-sync mode
  // ---------------------------------------------------------------------------

  /** Poll audio time at 100 ms for the mini player display. */
  const startSyncInterval = useCallback(() => {
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    syncIntervalRef.current = setInterval(() => {
      const audio = audioRef.current
      if (audio) setSyncCurrentMs(audio.currentTime * 1000)
    }, 100)
  }, [])

  const stopSyncInterval = useCallback(() => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current)
      syncIntervalRef.current = null
    }
  }, [])

  const enterResync = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setSyncIdx(0)
    setSyncCurrentMs(0)
    setSyncIsPlaying(false)
    setIsResyncing(true)
    startSyncInterval()
    // Scroll to first line
    setTimeout(() => inputRefs.current[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  }, [startSyncInterval])

  const exitResync = useCallback(() => {
    audioRef.current?.pause()
    stopSyncInterval()
    setIsResyncing(false)
    setSyncIsPlaying(false)
  }, [stopSyncInterval])

  const toggleSyncAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
      setSyncIsPlaying(true)
    } else {
      audio.pause()
      setSyncIsPlaying(false)
    }
  }, [])

  /** Capture current audio time as startMs for the focused line, advance to next. */
  const captureSync = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const capturedMs = Math.round(audio.currentTime * 1000)

    const updated = lines.map((l, i) =>
      i === syncIdx ? { ...l, startMs: capturedMs } : l,
    )
    // Re-derive endMs of the previous line to match this line's start
    if (syncIdx > 0) {
      updated[syncIdx - 1] = { ...updated[syncIdx - 1], endMs: capturedMs }
    }

    commit(updated)

    const nextIdx = syncIdx + 1
    if (nextIdx >= lines.length) {
      // All lines synced — exit re-sync
      exitResync()
      return
    }
    setSyncIdx(nextIdx)
    // Scroll next line into view
    setTimeout(
      () => inputRefs.current[nextIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    )
  }, [lines, syncIdx, commit, exitResync])

  // ---------------------------------------------------------------------------
  // Keyboard handlers
  // ---------------------------------------------------------------------------

  // Re-sync global keys (capture phase so they fire before input default handling)
  useEffect(() => {
    if (!isResyncing) return
    const handler = (e: globalThis.KeyboardEvent) => {
      switch (e.code) {
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          captureSync()
          break
        case 'Space':
          e.preventDefault()
          e.stopPropagation()
          toggleSyncAudio()
          break
        case 'Escape':
          exitResync()
          break
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [isResyncing, captureSync, toggleSyncAudio, exitResync])

  // Global undo/redo
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (isResyncing) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isResyncing, undo, redo])

  // ---------------------------------------------------------------------------
  // Save & Sing
  // ---------------------------------------------------------------------------

  const saveAndSing = useCallback(() => {
    // Sort lines by startMs before saving (re-sync can produce out-of-order lines)
    const sorted = [...lines].sort((a, b) => a.startMs - b.startMs)
    setLyrics(sorted)
    setPlayback({ currentTime: 0, isPlaying: false })
    setView('player')
  }, [lines, setLyrics, setPlayback, setView])

  const goBack = useCallback(() => {
    setView(streamUrl ? 'player' : 'home')
  }, [setView, streamUrl])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasLyrics = lines.length > 0
  const durationMs = (duration || 180) * 1000

  return (
    <div className="flex flex-col h-screen bg-[#050508] text-white overflow-hidden">
      {/* Hidden audio for re-sync */}
      <audio ref={audioRef} src={streamUrl} preload="auto" crossOrigin="anonymous" className="hidden" />

      {/* ── Header ── */}
      <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#050508]/90 backdrop-blur-md z-10">
        <button
          onClick={goBack}
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/70 truncate">
            {title || 'Lyrics Editor'}
          </p>
          <p className="text-[10px] text-white/30">
            {lines.length} line{lines.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label="Undo (⌘Z)"
            title="Undo (⌘Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label="Redo (⌘⇧Z)"
            title="Redo (⌘⇧Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Re-sync toggle */}
        <button
          onClick={isResyncing ? exitResync : enterResync}
          disabled={!streamUrl || lines.length === 0}
          className={[
            'flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0',
            isResyncing
              ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 animate-pulse'
              : 'text-white/50 hover:text-white hover:bg-white/5 border border-white/10',
            (!streamUrl || lines.length === 0) ? 'opacity-30 cursor-not-allowed' : '',
          ].join(' ')}
          title={!streamUrl ? 'No audio stream available' : isResyncing ? 'Re-syncing…' : 'Re-sync timing'}
          aria-label={isResyncing ? 'Stop re-syncing' : 'Re-sync timing'}
        >
          <Radio className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isResyncing ? 'Re-syncing…' : 'Re-sync'}</span>
        </button>

        {/* Save & Sing */}
        <button
          onClick={saveAndSing}
          disabled={lines.length === 0}
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/20 hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none shrink-0"
          aria-label="Save and sing"
        >
          <Mic2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Save &amp; Sing</span>
        </button>
      </header>

      {/* ── Scrollable content ── */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]"
        // Extra bottom padding when re-sync footer is visible
        style={{ paddingBottom: isResyncing ? '9rem' : '1rem' }}
      >
        {/* ── Paste section ── */}
        <div className="border-b border-white/5">
          <button
            onClick={() => setShowPaste((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.02] transition-all"
          >
            <ClipboardPaste className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">
              {showPaste ? 'Close paste panel' : 'Paste your own lyrics'}
            </span>
            <span className="text-xs text-white/20">
              {showPaste ? '▲' : '▼'}
            </span>
          </button>

          {showPaste && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-white/40 leading-relaxed">
                Paste plain-text lyrics below — one line per row. Timestamps will be distributed evenly
                across the song duration as a starting point. Use Re-sync mode to fine-tune them.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteError(null) }}
                placeholder={"Never gonna give you up\nNever gonna let you down\nNever gonna run around and desert you…"}
                rows={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 resize-y transition-all"
                spellCheck={false}
              />
              {pasteError && (
                <p className="text-red-400 text-xs">{pasteError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={applyPaste}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
                >
                  Apply lyrics
                </button>
                <button
                  onClick={() => { setShowPaste(false); setPasteText(''); setPasteError(null) }}
                  className="px-4 py-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Empty state ── */}
        {!hasLyrics && !showPaste && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <Music2 className="w-7 h-7 text-white/20" />
            </div>
            <div>
              <p className="text-white/50 font-medium">No lyrics yet</p>
              <p className="text-white/30 text-sm mt-1">
                Transcription may have failed, or you skipped it. Paste lyrics above to get started.
              </p>
            </div>
            <button
              onClick={() => setShowPaste(true)}
              className="px-4 py-2 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-violet-500 text-sm transition-all"
            >
              <ClipboardPaste className="w-3.5 h-3.5 inline mr-1.5" />
              Paste lyrics
            </button>
          </div>
        )}

        {/* ── Re-sync mode header ── */}
        {isResyncing && hasLyrics && (
          <div className="px-4 py-3 bg-violet-500/5 border-b border-violet-500/20">
            <p className="text-violet-300 text-sm font-medium">Re-sync mode active</p>
            <p className="text-violet-400/60 text-xs mt-0.5">
              Press <kbd className="px-1 py-0.5 bg-violet-500/20 rounded text-[10px]">Enter</kbd> to mark the highlighted line's start time ·
              <kbd className="ml-1 px-1 py-0.5 bg-violet-500/20 rounded text-[10px]">Space</kbd> to play/pause ·
              <kbd className="ml-1 px-1 py-0.5 bg-violet-500/20 rounded text-[10px]">Esc</kbd> to cancel
            </p>
          </div>
        )}

        {/* ── Lyrics list ── */}
        {hasLyrics && (
          <div>
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02] sticky top-0 z-10">
              {isResyncing && <div className="w-4 shrink-0" />}
              <span className="font-mono text-[10px] text-white/25 w-14 text-right shrink-0 uppercase tracking-wider">Time</span>
              <span className="text-[10px] text-white/25 uppercase tracking-wider flex-1">Lyric</span>
            </div>

            {lines.map((line, idx) => (
              <LineRow
                key={line.id}
                line={line}
                index={idx}
                isSyncFocused={isResyncing && idx === syncIdx}
                isResyncing={isResyncing}
                inputRef={(el) => { inputRefs.current[idx] = el }}
                onTextBlur={handleTextBlur}
                onDelete={handleDelete}
                onAddAfter={handleAddAfter}
                onFocus={(i) => { if (!isResyncing) setSyncIdx(i) }}
              />
            ))}

            {/* Add line at end */}
            {!isResyncing && (
              <button
                onClick={() => handleAddAfter(lines.length - 1)}
                className="w-full flex items-center gap-2 px-4 py-3 text-white/25 hover:text-violet-400 hover:bg-violet-500/5 transition-all text-sm"
              >
                <Plus className="w-4 h-4" />
                Add line
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Re-sync footer (fixed, only when active) ── */}
      {isResyncing && (
        <div
          className="fixed bottom-0 inset-x-0 z-20 border-t border-violet-500/20 bg-[#050508]/95 backdrop-blur-md px-4 pt-3"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          {/* Progress track */}
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-xs text-violet-300/70 tabular-nums w-10 text-right shrink-0">
              {formatSec(syncCurrentMs / 1000)}
            </span>
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-none"
                style={{ width: `${durationMs > 0 ? Math.min(100, (syncCurrentMs / durationMs) * 100) : 0}%` }}
              />
            </div>
            <span className="font-mono text-xs text-white/30 tabular-nums w-10 shrink-0">
              {formatSec(duration)}
            </span>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-violet-300/60 min-w-0">
              <span className="font-mono text-violet-400">
                {syncIdx + 1}/{lines.length}
              </span>
              <span className="ml-2 truncate text-white/30">
                {lines[syncIdx]?.text || '—'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Play/Pause */}
              <button
                onClick={toggleSyncAudio}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-violet-600 hover:bg-violet-500 text-white transition-all active:scale-95"
                aria-label={syncIsPlaying ? 'Pause' : 'Play'}
              >
                {syncIsPlaying
                  ? <Pause className="w-4 h-4 fill-white" />
                  : <Play className="w-4 h-4 fill-white translate-x-0.5" />}
              </button>

              {/* Tap / Enter button — for mobile where keyboard Enter may be awkward */}
              <button
                onClick={captureSync}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-medium transition-all active:scale-95 shadow-lg shadow-fuchsia-500/20"
              >
                ↵ Mark
              </button>
            </div>
          </div>

          {/* Exit hint */}
          <button
            onClick={exitResync}
            className="mt-2 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors"
          >
            Press Esc or tap here to cancel re-sync
          </button>
        </div>
      )}
    </div>
  )
}
