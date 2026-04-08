/**
 * lib/session-seen.ts
 *
 * Session-scoped seen-items tracking for cross-surface deduplication.
 *
 * Motivation
 * ──────────
 * Without this, the same high-scoring item can appear as the Top Pick on the
 * homepage AND at the top of the /for-you page AND in a pet chat message —
 * making the recommendation engine feel repetitive and low-signal.
 *
 * Design
 * ──────
 * Uses sessionStorage so the seen-set resets when the tab is closed or the
 * user starts a new browser session.  This gives fresh recommendations each
 * session without permanently suppressing popular items.
 *
 * Degrades silently when sessionStorage is unavailable (SSR, private mode,
 * storage quota exceeded) — dedup is best-effort, never a hard dependency.
 *
 * Usage
 * ─────
 *   // After rendering top picks:
 *   markSeen(topPicks.map(s => s.item.id))
 *
 *   // Before picking items for a second surface:
 *   const seen = getSeenIds()
 *   const newPicks = scored.filter(s => !seen.has(s.item.id))
 *
 * Reset
 * ─────
 *   resetSeen() — call when the user explicitly refreshes recommendations
 *   or when you want to start a clean slate within a session.
 *   Automatic reset happens on tab close (sessionStorage behaviour).
 */

const KEY = 'nearu-seen-v1'

/** Returns the current session-level seen-item ID set. */
export function getSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set<string>(parsed) : new Set()
  } catch {
    return new Set()
  }
}

/** Adds item IDs to the session-level seen set. */
export function markSeen(ids: string[]): void {
  if (typeof window === 'undefined' || ids.length === 0) return
  try {
    const existing = getSeenIds()
    ids.forEach(id => existing.add(id))
    // Cap at 200 entries — oldest removed (FIFO via Set iteration order)
    const arr = [...existing]
    const trimmed = arr.length > 200 ? arr.slice(arr.length - 200) : arr
    sessionStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {}
}

/** Clears the session-level seen set. */
export function resetSeen(): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.removeItem(KEY) } catch {}
}
