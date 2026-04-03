import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useKaraokeStore } from '@/store/useKaraokeStore'
import { decodeStateFromUrl } from '@/lib/share'

/**
 * PRD §6.5 — Share URL hydration (synchronous pre-init).
 *
 * Runs before createRoot so the very first React render already has
 * view:'player' and lyrics populated — zero flash of the Home screen.
 *
 * The async stream-URL fetch is handled by App.tsx after mount.
 */
const initialHash = window.location.hash
if (initialHash && initialHash.length > 1) {
  const decoded = decodeStateFromUrl(initialHash)
  if (decoded) {
    useKaraokeStore.setState({
      lyrics: decoded.lyrics,
      youtubeUrl: decoded.youtubeUrl,
      view: 'player',
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
