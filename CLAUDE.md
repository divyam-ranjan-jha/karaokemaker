# KaraokeMaker — Project Context

> **Operating Rules for Claude:**
> - **Initialization**: At the start of every new terminal session, or when the user says "refresh context", automatically read this file (`CLAUDE.md`) first before doing anything else, so we can pick up exactly where we left off.
> - **Maintenance**: When the user says "update context" or "update claude.md", overwrite this file to accurately reflect the latest project state — crossed-off completed tasks, newly broken things, new decisions, and updated recent context.
> - This file is the single source of truth for project state across sessions.

---

## 1. Project Overview

**KaraokeMaker** is a YouTube-to-karaoke web app. The user pastes a YouTube URL, the app extracts the audio via a Cloudflare Worker proxy, transcribes it with Whisper WASM (running in a Web Worker), and displays auto-synced, word-highlighted lyrics in a full-screen karaoke player.

Key goals:
- Zero sign-up, zero backend (stateless Cloudflare Worker only)
- Under 30 seconds from URL paste to singing
- Shareable karaoke links via lz-string URL encoding
- Fully mobile-responsive

PRD is stored at `KaraokeMaker_PRD_v1.docx` in the project root.

---

## 2. Tech Stack & Architecture

### Frontend
| Layer | Choice |
|---|---|
| Framework | React 19 + TypeScript 6 |
| Build tool | Vite 8 |
| Styling | TailwindCSS v4 (`@import "tailwindcss"`, `@tailwindcss/postcss`) |
| State | Zustand 5 (three slices: Meta, Playback, Lyrics) |
| Icons | lucide-react 1.7.0 |
| Toasts | react-hot-toast 2.6.0 |
| URL sharing | lz-string (`compressToEncodedURIComponent`) |
| AI transcription | @xenova/transformers (Whisper tiny, WASM, Web Worker) |

### Backend
| Layer | Choice |
|---|---|
| Proxy | Cloudflare Worker (`proxy-worker/src/index.ts`) |
| Audio source | Invidious API (4 fallback instances) |
| Auth | None — stateless |

### Key architectural decisions
- **RAF loop** for 60fps lyric sync — direct DOM writes, no React re-renders
- **Web Worker** for Whisper — keeps UI thread free
- **`?worker` import** — worker is imported using Vite's `?worker` suffix (`import WhisperWorkerClass from '@/workers/whisper.worker.ts?worker'`) to force Vite to bundle the worker even in dev mode. Do NOT change this back to `new Worker(new URL(...))` — it breaks dev mode.
- **No-flash hydration** — `useKaraokeStore.setState()` called synchronously in `main.tsx` before `createRoot` so share URLs render player immediately
- **COOP/COEP headers** — required for SharedArrayBuffer; set in `vite.config.ts` for dev/preview and `vercel.json` for Vercel production. Uses `credentialless` (NOT `require-corp`) so cross-origin resources load without needing CORP headers.
- **`numThreads: 1`** — avoids SharedArrayBuffer requirement in Whisper worker
- **PCM on main thread** — audio is always decoded to PCM on the main thread via `AudioContext(16kHz)` and the `Float32Array` is transferred to the worker. The worker does NOT use `AudioContext` (it's unavailable in workers). Never send `TRANSCRIBE_URL` to the worker.
- **Parallel model + audio download** — `LOAD_MODEL` command is sent to the worker immediately when transcription starts, so the ~29MB Whisper model downloads in parallel with the ~3MB audio file
- **Audio stream proxy (dev only)** — Vite dev server has a custom plugin (`audioStreamProxy()` in `vite.config.ts`) that serves `/audio-stream?url=<encoded>` to proxy YouTube CDN audio through localhost, bypassing CORS for both `<audio>` tags and PCM fetch
- **Worker API proxy (dev only)** — Vite dev server proxies `/km-proxy/*` → deployed Cloudflare Worker, since the worker CORS only allows the Vercel origin

### Folder structure
```
src/
  components/
    home/        — Home.tsx (URL input, 3-stage FSM)
    player/      — KaraokePlayer.tsx (RAF sync, neon highlight)
    editor/      — LyricsEditor.tsx (undo/redo, re-sync, paste)
    ui/          — (reserved)
  hooks/         — useWhisper.ts
  lib/           — lyrics.ts, format.ts, share.ts
  services/      — youtube.ts (Cloudflare Worker client + proxy helpers)
  store/         — useKaraokeStore.ts
  workers/       — whisper.worker.ts, whisper.types.ts
proxy-worker/
  src/index.ts   — Cloudflare Worker (Invidious proxy)
  wrangler.toml
```

---

## 3. Current State & Open Tasks

### Completed
- [x] Vite + React + TypeScript project init
- [x] TailwindCSS v4 setup
- [x] Folder structure + barrel index files
- [x] Cloudflare Worker proxy (`proxy-worker/`) — deployed
- [x] Zustand store (3 slices + actions)
- [x] Home.tsx — URL input, 3-stage FSM (idle → extracting → transcribing)
- [x] Whisper WASM layer — Web Worker + PCM fallback
- [x] KaraokePlayer.tsx — RAF loop, neon word highlight, countdown, share
- [x] LyricsEditor.tsx — undo/redo, re-sync mode, paste panel
- [x] URL sharing (PRD §6.5) — lz-string hash, no-flash hydration
- [x] Toast notifications (react-hot-toast) — extraction error codes mapped
- [x] Mobile responsiveness — safe-area insets, responsive font sizes, icon-only buttons on mobile
- [x] ErrorBoundary in App.tsx — shows error details instead of blank white screen
- [x] `vercel.json` — COOP/COEP headers for production
- [x] Cloudflare Worker deployed
- [x] Frontend deployed on Vercel
- [x] Worker CORS locked to Vercel origin
- [x] Fix white screen bug (Zustand inline object selector → individual selectors)
- [x] Fix COEP blocking cross-origin resources (`require-corp` → `credentialless`)
- [x] Fix `registerBackend` error (pre-bundle `@xenova/transformers` + `onnxruntime-web` via `optimizeDeps.include`)
- [x] Fix worker module loading in dev mode (`?worker` import suffix)
- [x] Fix `AudioContext` unavailable in worker (always decode PCM on main thread)
- [x] Add parallel model download (`LOAD_MODEL` worker command)
- [x] Add audio download progress reporting
- [x] Fix CORS for audio playback (Vite audio stream proxy for localhost)
- [x] Update Invidious instances to working ones (4 active as of Apr 2026)

### Known Issues / Future Improvements
- [ ] **Performance**: Transcription takes 2-5 minutes for a typical song — Whisper tiny on single-threaded WASM is slow. Could explore Whisper small/medium for quality vs. speed tradeoff, or server-side transcription.
- [ ] **Audio download speed**: The YouTube CDN stream can take 30-60 seconds to download through the proxy on some connections.
- [ ] **Invidious instance reliability**: Instances go down frequently. The `INVIDIOUS_INSTANCES` list in `proxy-worker/src/index.ts` may need periodic updates. Check `https://api.invidious.io/instances.json` for active ones.
- [ ] **Production audio CORS**: On Vercel, `<audio>` and `fetch()` calls go directly to the YouTube CDN `streamUrl`. This works because `COEP: credentialless` doesn't block opaque responses. If browsers tighten this, may need a server-side audio proxy for production too.

---

## 4. Critical Rules & Gotchas

### Zustand selectors — NEVER use inline object selectors
```ts
// BAD — returns new object reference every render → infinite re-render loop
useKaraokeStore((s) => ({ title: s.title, thumbnailUrl: s.thumbnailUrl }))

// GOOD — primitive values are compared by value, stable snapshots
const metaTitle = useKaraokeStore((s) => s.title)
const metaThumbnailUrl = useKaraokeStore((s) => s.thumbnailUrl)
```

### Worker imports — always use `?worker` suffix
```ts
// GOOD — Vite bundles the worker in both dev and prod
import WhisperWorkerClass from '@/workers/whisper.worker.ts?worker'
const worker = new WhisperWorkerClass()

// BAD — breaks in dev mode, ESM imports fail inside worker
const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
```

### Audio decoding — always on main thread
The Whisper worker does NOT have access to `AudioContext`. Audio must be fetched and decoded to PCM (`Float32Array`) on the main thread, then transferred to the worker via `TRANSCRIBE_PCM`. Never use `TRANSCRIBE_URL`.

### `optimizeDeps.include` is critical
`@xenova/transformers` and `onnxruntime-web` MUST be in `optimizeDeps.include` in `vite.config.ts`. Without this, Vite's dev server serves the raw webpack bundle of `onnxruntime-web` which has circular initialization issues (`registerBackend` error).

### npm install
Always use `--legacy-peer-deps` for this project — peer dependency conflicts exist between React 19 and several packages.

### WASM paths
`whisper.worker.ts` explicitly sets `env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/'` to ensure ONNX WASM binaries load correctly regardless of bundling.

---

## 5. Deployment

### Deployment status
| Resource | URL | Status |
|---|---|---|
| Cloudflare Worker | `https://karaokemaker-proxy.divyamranjan1602.workers.dev` | ✅ Live |
| Vercel frontend | `https://karaokemaker-five.vercel.app` | ✅ Live |
| GitHub repo | `https://github.com/divyam-ranjan-jha/karaokemaker` | ✅ Active |

### Vercel build settings (confirmed working)
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install --legacy-peer-deps` ← **critical, do not remove**
- Env var: `VITE_WORKER_URL=https://karaokemaker-proxy.divyamranjan1602.workers.dev`

### Vercel vs localhost differences
| Feature | Localhost (dev) | Vercel (production) |
|---|---|---|
| Worker API calls | Proxied through `/km-proxy/*` (Vite proxy) | Direct to `https://karaokemaker-proxy.divyamranjan1602.workers.dev` |
| Audio stream for `<audio>` & PCM | Proxied through `/audio-stream?url=...` (Vite plugin) | Direct YouTube CDN URL (works with `COEP: credentialless`) |
| COOP/COEP headers | Set in `vite.config.ts` `server.headers` | Set in `vercel.json` |
| Audio stream proxy plugin | Active (`audioStreamProxy()` Vite plugin) | Not needed (no Vite server) |

### Cloudflare Worker deployment
```bash
cd proxy-worker
npx wrangler deploy
```
The worker CORS (`ALLOWED_ORIGIN`) is set to `*` in `wrangler.toml` for dev but should be restricted to `https://karaokemaker-five.vercel.app` via Cloudflare dashboard env vars in production.

### Invidious instances (as of April 2026)
The worker uses these 4 instances (in `proxy-worker/src/index.ts`):
1. `https://inv.thepixora.com`
2. `https://invidious.protokolla.fi`
3. `https://invidious.einfachzocken.eu`
4. `https://invidious.darkness.services`

If extraction fails with "all instances failed", check `https://api.invidious.io/instances.json` for active instances and update the list, then redeploy the worker.

---

## 6. Important File Locations

| File | Purpose |
|---|---|
| `src/App.tsx` | App shell + ErrorBoundary |
| `src/main.tsx` | Synchronous share-URL hydration before React mount |
| `src/store/useKaraokeStore.ts` | Single Zustand store |
| `src/hooks/useWhisper.ts` | Whisper worker lifecycle, PCM decode, parallel model loading |
| `src/workers/whisper.worker.ts` | WASM transcription worker (Whisper tiny) |
| `src/workers/whisper.types.ts` | Worker message types (`LOAD_MODEL`, `TRANSCRIBE_PCM`, etc.) |
| `src/lib/share.ts` | URL encode/decode (lz-string) |
| `src/services/youtube.ts` | Cloudflare Worker client + `proxyStreamUrl()` + `extractRequestUrl()` |
| `src/components/home/Home.tsx` | URL input, extraction, transcription FSM |
| `src/components/editor/LyricsEditor.tsx` | Lyrics editing + re-sync |
| `src/components/player/KaraokePlayer.tsx` | Full-screen karaoke player |
| `src/vite-env.d.ts` | TypeScript declarations (includes `?worker` module type) |
| `vite.config.ts` | COOP/COEP headers, audio proxy plugin, worker config, optimizeDeps |
| `vercel.json` | Production COOP/COEP headers |
| `proxy-worker/src/index.ts` | Cloudflare Worker (Invidious proxy, 4 instances) |
| `proxy-worker/wrangler.toml` | Worker config — `ALLOWED_ORIGIN` |

---

## 7. End-to-End Flow

1. **User pastes YouTube URL** → `Home.tsx` validates, calls `extractAudio()` from `youtube.ts`
2. **`extractAudio()`** → on localhost: `fetch('/km-proxy/extract?url=...')` (Vite proxies to worker); on Vercel: `fetch('https://karaokemaker-proxy.../extract?url=...')`
3. **Cloudflare Worker** → tries 4 Invidious instances, returns `{ streamUrl, title, durationSeconds, thumbnailUrl }`
4. **Home.tsx stores meta** in Zustand, transitions to `transcribing` stage
5. **`useWhisper.transcribe()`** → sends `LOAD_MODEL` to worker (starts ~29MB model download); simultaneously fetches audio on main thread via `proxyStreamUrl(streamUrl)`, decodes to 16kHz mono `Float32Array` via `AudioContext`
6. **Worker receives `TRANSCRIBE_PCM`** → runs Whisper tiny inference, posts back `{ segments }` with timestamps
7. **Home.tsx receives lyrics** → stores in Zustand, navigates to `editor` view
8. **LyricsEditor** — user can edit words, re-sync timestamps, paste custom lyrics
9. **KaraokePlayer** — RAF loop highlights current word with neon glow, audio plays via `<audio>` tag (using `proxyStreamUrl` on localhost)
10. **Share** — lyrics compressed via lz-string into URL hash
