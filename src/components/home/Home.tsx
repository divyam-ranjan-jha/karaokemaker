import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  Mic2, Link2, ArrowRight, Loader2,
  Zap, Lock, Sparkles, AlertCircle, Brain,
} from 'lucide-react'
import { extractAudio, ExtractionError } from '@/services/youtube'
import { useKaraokeStore } from '@/store/useKaraokeStore'
import { useWhisper } from '@/hooks/useWhisper'
import type { LyricLine } from '@/lib/lyrics'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const YT_PATTERN =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

const EXTRACT_MESSAGES = [
  'Connecting to YouTube…',
  'Fetching audio stream…',
  'Extracting metadata…',
  'Almost ready…',
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = 'idle' | 'extracting' | 'transcribing'
type TranscribePhase = 'model' | 'audio'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidYouTubeUrl(url: string): boolean {
  return YT_PATTERN.test(url)
}

/** Map ExtractionError codes to concise, user-friendly toast messages. */
function extractionToastMessage(err: ExtractionError): string {
  switch (err.code) {
    case 'AGE_RESTRICTED':
      return 'This video is age-restricted and can\'t be processed.'
    case 'GEO_BLOCKED':
      return 'This video isn\'t available in your region.'
    case 'LIVE_STREAM':
      return 'Live streams aren\'t supported — try a recorded video.'
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.'
    case 'NETWORK_ERROR':
      return 'Can\'t reach the extraction service. Check your connection.'
    default:
      return err.message || 'Audio extraction failed. Please try a different video.'
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Shown while the Cloudflare Worker resolves the stream URL. */
function ExtractingView({ url }: { url: string }) {
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % EXTRACT_MESSAGES.length), 1800)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-lg">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-2 border-violet-500/20 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
        </div>
        <div className="absolute inset-0 rounded-full bg-violet-500/10 animate-ping" />
      </div>
      <div className="text-center">
        <p className="text-white font-medium text-lg">{EXTRACT_MESSAGES[msgIdx]}</p>
        <p className="text-white/40 text-sm mt-1 truncate max-w-xs">{url}</p>
      </div>
      <div className="w-full space-y-3 animate-pulse">
        {[80, 60, 72, 50, 65].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded-full bg-white/5"
            style={{ width: `${w}%`, marginLeft: i % 2 === 0 ? '0' : 'auto' }}
          />
        ))}
      </div>
    </div>
  )
}

/** Shown while Whisper is downloading the model or transcribing audio. */
function TranscribingView({
  phase,
  progress,
  phaseLabel,
  title,
  thumbnailUrl,
  onSkip,
}: {
  phase: TranscribePhase
  progress: number
  phaseLabel: string
  title: string
  thumbnailUrl: string | null
  onSkip: () => void
}) {
  // Overall progress:
  //  model phase = 0–50 %  (mapped from 0–100 model download)
  //  audio phase = 50–100% (mapped from 0–100 transcription)
  const overallPct =
    phase === 'model'
      ? Math.round(progress * 0.5)
      : 50 + Math.round(progress * 0.5)

  return (
    <div className="flex flex-col items-center gap-6 sm:gap-8 w-full max-w-lg">
      {/* Song identity */}
      <div className="flex items-center gap-3 sm:gap-4 w-full">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover shrink-0 shadow-lg shadow-black/40"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
            <Mic2 className="w-7 h-7 text-violet-400" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{title || 'Loading song…'}</p>
          <div className="flex items-center gap-2 mt-1">
            <Brain className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <p className="text-violet-300 text-sm truncate">{phaseLabel}</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="flex justify-between items-center mb-2">
          <span className="text-white/50 text-xs font-mono">
            {phase === 'model' ? 'Loading AI model' : 'Transcribing lyrics'}
          </span>
          <span className="text-violet-400 text-xs font-mono tabular-nums">{overallPct}%</span>
        </div>
        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500 ease-out"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        {/* Step indicators */}
        <div className="flex justify-between mt-3">
          {(['model', 'audio'] as const).map((p) => {
            const done = phase === 'audio' || (phase === 'model' && p === 'model')
            const active = phase === p
            return (
              <div key={p} className="flex items-center gap-1.5">
                <div
                  className={[
                    'w-1.5 h-1.5 rounded-full transition-all',
                    active ? 'bg-violet-400 scale-125' : done ? 'bg-fuchsia-500' : 'bg-white/15',
                  ].join(' ')}
                />
                <span className={['text-xs', active ? 'text-white/70' : 'text-white/25'].join(' ')}>
                  {p === 'model' ? 'Download model' : 'Transcribe audio'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Skip option (P1 — user can bypass transcription) */}
      <button
        onClick={onSkip}
        className="text-sm text-white/30 hover:text-white/60 transition-colors underline underline-offset-4"
      >
        Skip — I'll paste my own lyrics
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  // Form state
  const [url, setUrl] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Loading FSM
  const [stage, setStage] = useState<Stage>('idle')
  const [transcribePhase, setTranscribePhase] = useState<TranscribePhase>('model')
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const [transcribeLabel, setTranscribeLabel] = useState('Preparing…')
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // Store
  const setMeta = useKaraokeStore((s) => s.setMeta)
  const setLyrics = useKaraokeStore((s) => s.setLyrics)
  const setView = useKaraokeStore((s) => s.setView)
  const metaTitle = useKaraokeStore((s) => s.title)
  const metaThumbnailUrl = useKaraokeStore((s) => s.thumbnailUrl)

  // Whisper hook
  const { transcribe, cancel, isSupported } = useWhisper({
    onModelLoading: (progress, label) => {
      setTranscribePhase('model')
      setTranscribeProgress(progress)
      setTranscribeLabel(label)
    },
    onTranscribing: (progress) => {
      setTranscribePhase('audio')
      setTranscribeProgress(progress)
      setTranscribeLabel(`Transcribing lyrics… ${50 + Math.round(progress * 0.5)}%`)
    },
    onComplete: (lyrics: LyricLine[]) => {
      setLyrics(lyrics)
      setView('editor')
    },
    onError: (message) => {
      setTranscribeError(message)
      toast.error('Transcription failed — paste your own lyrics to continue.')
    },
  })

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleChange(value: string) {
    setUrl(value)
    setFieldError(
      value && !isValidYouTubeUrl(value)
        ? 'Please enter a valid YouTube URL (youtube.com or youtu.be)'
        : null,
    )
  }

  function handleDemo() {
    handleChange(DEMO_URL)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  /** User wants to skip transcription and type their own lyrics. */
  function handleSkipTranscription() {
    cancel()
    setLyrics([])
    setView('editor')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const trimmed = url.trim()
    if (!trimmed) {
      setFieldError('Please paste a YouTube URL to get started.')
      return
    }
    if (!isValidYouTubeUrl(trimmed)) {
      setFieldError('Please enter a valid YouTube URL (youtube.com or youtu.be)')
      return
    }

    setFieldError(null)
    setTranscribeError(null)
    setStage('extracting')

    try {
      // Step 1: resolve audio stream via Cloudflare Worker
      const meta = await extractAudio(trimmed)

      setMeta({
        youtubeUrl: trimmed,
        streamUrl: meta.streamUrl,
        title: meta.title,
        thumbnailUrl: meta.thumbnailUrl,
        duration: meta.durationSeconds,
      })

      // Step 2: kick off Whisper transcription in the background worker
      if (!isSupported) {
        // Browser doesn't support WASM — go straight to editor with empty lyrics
        setLyrics([])
        setView('editor')
        return
      }

      setStage('transcribing')
      setTranscribePhase('model')
      setTranscribeProgress(0)
      setTranscribeLabel('Preparing…')
      transcribe(meta.streamUrl, meta.durationSeconds)
    } catch (err) {
      if (err instanceof ExtractionError) {
        toast.error(extractionToastMessage(err))
        setFieldError(err.message)
      } else {
        toast.error('Something went wrong. Please try again.')
        setFieldError('Something went wrong. Please try again.')
      }
      setStage('idle')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative min-h-screen bg-[#050508] flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      {/* Background glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 sm:gap-10 w-full max-w-2xl">

        {/* Brand — always visible */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/30">
            <Mic2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-center">
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              KaraokeMaker
            </span>
          </h1>
          {stage === 'idle' && (
            <p className="text-white/50 text-lg text-center max-w-sm leading-relaxed">
              Paste any YouTube link. Get auto-synced lyrics. Sing instantly.
            </p>
          )}
        </div>

        {/* Stage-dependent body */}
        <div className="w-full flex justify-center">
          {stage === 'idle' && (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 w-full">
              {/* Input row */}
              <div className="relative flex items-center">
                <Link2 className="absolute left-4 w-5 h-5 text-white/30 pointer-events-none shrink-0" />
                <input
                  ref={inputRef}
                  type="url"
                  value={url}
                  onChange={(e) => handleChange(e.target.value)}
                  onPaste={(e) => handleChange(e.clipboardData.getData('text'))}
                  placeholder="https://youtube.com/watch?v=..."
                  autoComplete="off"
                  spellCheck={false}
                  className={[
                    'w-full bg-white/5 border rounded-2xl',
                    'pl-12 pr-14 py-4',
                    'text-white placeholder:text-white/25 text-base',
                    'focus:outline-none focus:ring-2 transition-all duration-200',
                    fieldError
                      ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-white/10 focus:border-violet-500 focus:ring-violet-500/20',
                  ].join(' ')}
                />
                <button
                  type="submit"
                  disabled={!!fieldError || !url.trim()}
                  aria-label="Start karaoke"
                  className={[
                    'absolute right-2 flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200',
                    fieldError || !url.trim()
                      ? 'bg-white/5 text-white/20 cursor-not-allowed'
                      : 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-105 active:scale-95',
                  ].join(' ')}
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Inline field error */}
              {fieldError && (
                <p className="flex items-center gap-1.5 text-red-400 text-sm pl-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {fieldError}
                </p>
              )}

              {/* Demo CTA */}
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="text-white/30 text-sm">No URL handy?</span>
                <button
                  type="button"
                  onClick={handleDemo}
                  className="text-sm text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Try a demo song
                </button>
              </div>

              {/* WASM warning */}
              {!isSupported && (
                <p className="text-amber-400/80 text-xs text-center pt-1">
                  WebAssembly is not available — auto-transcription is disabled. You can still paste your own lyrics.
                </p>
              )}
            </form>
          )}

          {stage === 'extracting' && <ExtractingView url={url} />}

          {stage === 'transcribing' && (
            <div className="flex flex-col items-center gap-4 w-full">
              <TranscribingView
                phase={transcribePhase}
                progress={transcribeProgress}
                phaseLabel={transcribeLabel}
                title={metaTitle}
                thumbnailUrl={metaThumbnailUrl}
                onSkip={handleSkipTranscription}
              />
              {/* Transcription error with fallback option */}
              {transcribeError && (
                <div className="w-full max-w-lg rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex flex-col gap-3">
                  <div className="flex gap-2 items-start">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-red-300 text-sm">{transcribeError}</p>
                  </div>
                  <button
                    onClick={handleSkipTranscription}
                    className="self-start text-sm text-white/60 hover:text-white transition-colors underline underline-offset-2"
                  >
                    Continue with empty lyrics →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Feature pills — only on idle */}
        {stage === 'idle' && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { icon: Zap, label: 'Under 30 seconds' },
              { icon: Lock, label: 'No account needed' },
              { icon: Mic2, label: 'Any YouTube song' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/[0.08] text-white/50 text-sm"
              >
                <Icon className="w-3.5 h-3.5 text-violet-400" />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}