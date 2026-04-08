/**
 * lib/session-seen.ts
 *
 * Session-scoped seen-items tracking for cross-surface deduplication
 * and lightweight impression-frequency negative signals.
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
 * Usage — cross-surface dedup
 * ───────────────────────────
 *   // After rendering top picks:
 *   markSeen(topPicks.map(s => s.item.id))
 *
 *   // Before picking items for a second surface:
 *   const seen = getSeenIds()
 *   const newPicks = scored.filter(s => !seen.has(s.item.id))
 *
 * Usage — impression frequency (negative signal)
 * ───────────────────────────────────────────────
 *   // Each time items are rendered to the user:
 *   trackImpression(renderedItems.map(s => s.item.id))
 *
 *   // Before scoring, penalise over-shown items:
 *   const overshown = getOvershownIds(3)   // shown 3+ times without a click
 *   const scored = applyImpressionPenalty(rawScored, overshown)
 *
 * Reset
 * ─────
 *   resetSeen() — call when the user explicitly refreshes recommendations
 *   or when you want to start a clean slate within a session.
 *   Automatic reset happens on tab close (sessionStorage behaviour).
 */

// ── Cross-surface dedup ───────────────────────────────────────────────────────

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

// ── Impression frequency (negative signal) ────────────────────────────────────
//
// Tracks how many times each item has been rendered to the user this session.
// Items shown repeatedly without any click are candidates for a score penalty —
// the user has had the chance to engage but hasn't.  This prevents a small set
// of high-scoring items from monopolising every surface.
//
// Design notes:
//   - Stored as Record<id, count> in sessionStorage under a separate key.
//   - Counts are incremented each time an item is rendered (not per page load).
//   - Threshold is caller-defined; 3 is a sensible default.
//   - Capped at 500 entries to avoid unbounded growth.

const IMPRESSION_KEY = 'nearu-impressions-v1'

/** Read the raw impression counts map from sessionStorage. */
function loadImpressions(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(IMPRESSION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Increment the impression counter for each given item ID.
 *
 * `firstScreenCount` — how many of the leading items in `ids` are in the
 * first-screen visible positions (above the fold).  First-screen exposures
 * accumulate at weight 2 per render because the user definitely saw them.
 * Below-fold items accumulate at weight 1 — the user may have scrolled past
 * without noticing.
 *
 * Calibration:
 *   - First-screen threshold = 4 weighted points → shown twice first-screen
 *     (2+2=4) or seen four times below-fold (1×4=4).
 *   - This prevents punishing items that happen to appear deep in a long feed
 *     the user never scrolled to, while strongly penalising items that have
 *     been featured prominently and repeatedly ignored.
 *
 * Call this every time a set of items becomes visible to the user.
 */
export function trackImpression(ids: string[], firstScreenCount: number = 0): void {
  if (typeof window === 'undefined' || ids.length === 0) return
  try {
    const counts = loadImpressions()
    for (let i = 0; i < ids.length; i++) {
      // First-screen items (positions 0…firstScreenCount-1) weight 2; rest weight 1
      const weight     = i < firstScreenCount ? 2 : 1
      counts[ids[i]]   = (counts[ids[i]] ?? 0) + weight
    }
    // Cap at 500 entries — evict lowest-count entries first
    const entries = Object.entries(counts)
    if (entries.length > 500) {
      entries.sort(([, a], [, b]) => b - a)   // descending by count
      const trimmed = Object.fromEntries(entries.slice(0, 500))
      sessionStorage.setItem(IMPRESSION_KEY, JSON.stringify(trimmed))
    } else {
      sessionStorage.setItem(IMPRESSION_KEY, JSON.stringify(counts))
    }
  } catch {}
}

/**
 * Returns the set of item IDs whose weighted impression score meets or exceeds
 * `threshold` this session.
 *
 * Default threshold of 4 means an item is "over-shown" when it has been:
 *   - displayed first-screen twice (2+2 = 4), OR
 *   - displayed below-fold four times (1×4 = 4), OR
 *   - any combination that sums to 4.
 *
 * These IDs are candidates for `applyImpressionPenalty` in recommendations.ts.
 */
export function getOvershownIds(threshold: number = 4): Set<string> {
  const counts = loadImpressions()
  return new Set(
    Object.entries(counts)
      .filter(([, count]) => count >= threshold)
      .map(([id]) => id),
  )
}
