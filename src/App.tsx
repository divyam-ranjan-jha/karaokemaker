import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { useKaraokeStore } from '@/store/useKaraokeStore'
import { Home } from '@/components/home'
import { KaraokePlayer } from '@/components/player'
import { LyricsEditor } from '@/components/editor'
import { decodeStateFromUrl } from '@/lib/share'
import { extractAudio } from '@/services/youtube'

/**
 * App shell.
 *
 * Share-URL flow (PRD §6.5):
 *   main.tsx    — synchronously pre-populates the store with lyrics + view:'player'
 *   App (here)  — kicks off the async stream-URL fetch so audio loads ASAP
 *
 * The two-step split ensures the player renders immediately (lyrics visible,
 * audio controls shown disabled) while the Worker resolves the stream URL.
 */
export default function App() {
  const view = useKaraokeStore((s) => s.view)
  const setMeta = useKaraokeStore((s) => s.setMeta)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash.length <= 1) return

    const decoded = decodeStateFromUrl(hash)
    if (!decoded) return

    // main.tsx already set lyrics + view. Now fetch the live stream URL.
    extractAudio(decoded.youtubeUrl)
      .then((meta) => {
        setMeta({
          youtubeUrl: decoded.youtubeUrl,
          streamUrl: meta.streamUrl,
          title: meta.title,
          thumbnailUrl: meta.thumbnailUrl,
          duration: meta.durationSeconds,
        })
      })
      .catch(() => {
        // Stream fetch failed — player shows an error banner.
        // Lyrics are still visible; user can edit them.
      })
  }, [setMeta])

  return (
    <>
      {view === 'home' && <Home />}
      {view === 'player' && <KaraokePlayer />}
      {view === 'editor' && <LyricsEditor />}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#18181b',
            color: '#e4e4e7',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            fontSize: '14px',
            maxWidth: '380px',
          },
          success: { iconTheme: { primary: '#a78bfa', secondary: '#18181b' } },
          error:   { iconTheme: { primary: '#f87171', secondary: '#18181b' } },
        }}
      />
    </>
  )
}
