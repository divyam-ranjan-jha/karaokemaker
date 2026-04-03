/**
 * Format a duration in seconds as M:SS (e.g. 3:07, 1:02:45 for long content).
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const totalSecs = Math.floor(seconds)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  const ss = s.toString().padStart(2, '0')
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}
