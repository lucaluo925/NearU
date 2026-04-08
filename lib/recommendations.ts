/**
 * lib/recommendations.ts
 *
 * Pure, shared recommendation utilities.
 * No React, no side-effects — safe to import in client and server contexts.
 *
 * Used by:
 *   - components/HomePersonalization.tsx  (homepage For You section)
 *   - app/for-you/ForYouClient.tsx        (/for-you page)
 */

import type { Item }          from '@/lib/types'
import type { TasteProfile }  from '@/hooks/useTasteProfile'
import type { InterestsStore } from '@/hooks/useInterests'
import { topNKeys }           from '@/hooks/useTasteProfile'

// ── Score context ─────────────────────────────────────────────────────────────

export interface ScoreContext {
  /** Tags the user explicitly saved (cuisines, vibes, prices) */
  savedTagSet:    Set<string>
  /** Categories the user explicitly saved */
  savedCatSet:    Set<string>
  /** Top-3 categories by click count */
  clickedCatTop:  Set<string>
  /** Top-3 subcategories by click count */
  clickedSubTop:  Set<string>
  /** Top-10 tags by click count */
  clickedTagTop:  Set<string>
}

export interface ScoredItem {
  item:   Item
  score:  number
  reason: string | null
}

export interface TopPicks {
  top:     ScoredItem | null
  backups: ScoredItem[]
}

/** Empty context — safe default when no profile data is available. */
export const EMPTY_CTX: ScoreContext = {
  savedTagSet:   new Set(),
  savedCatSet:   new Set(),
  clickedCatTop: new Set(),
  clickedSubTop: new Set(),
  clickedTagTop: new Set(),
}

export function buildScoreContext(
  interests: InterestsStore,
  profile:   TasteProfile,
): ScoreContext {
  return {
    savedTagSet:   new Set(
      [...interests.cuisines, ...interests.vibes, ...interests.prices]
        .map(t => t.toLowerCase()),
    ),
    savedCatSet:   new Set(interests.categories),
    clickedCatTop: new Set(topNKeys(profile.categoryCounts, 3)),
    clickedSubTop: new Set(topNKeys(profile.subcategoryCounts, 3)),
    clickedTagTop: new Set(topNKeys(profile.tagCounts, 10)),
  }
}

// ── Multi-signal scorer ───────────────────────────────────────────────────────
//
//  Behavioural (strongest — user told us or repeatedly chose):
//    +4  saved favourite category
//    +3  frequently-clicked category  (top-3 from history)
//    +2  frequently-clicked subcategory
//    +2  per matching saved interest tag
//    +1  per matching clicked tag
//
//  Temporal relevance:
//    +3  happening today  (< 24 h away)
//    +1  happening this week
//
//  Content freshness:
//    +2  created < 3 days ago
//    +1  created < 7 days ago
//
//  Quality:
//    +1  avg_rating ≥ 4.0
//   −2  no image AND no rating  (low-quality listing)

export function scoreItem(item: Item, ctx: ScoreContext): number {
  let score = 0

  // ── Behavioural ──────────────────────────────────────────────────────────
  if (ctx.savedCatSet.has(item.category))                             score += 4
  if (ctx.clickedCatTop.has(item.category))                          score += 3
  if (item.subcategory && ctx.clickedSubTop.has(item.subcategory))   score += 2

  const itemTags = (item.tags ?? []).map(t => t.toLowerCase())
  score += itemTags.filter(t => ctx.savedTagSet.has(t)).length * 2
  score += itemTags.filter(t => ctx.clickedTagTop.has(t)).length

  // ── Temporal ─────────────────────────────────────────────────────────────
  if (item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h > 0 && h < 24)         score += 3
    else if (h >= 24 && h < 168) score += 1
  }

  // ── Freshness ────────────────────────────────────────────────────────────
  if (item.created_at) {
    const d = (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
    if (d < 3) score += 2
    else if (d < 7) score += 1
  }

  // ── Quality ──────────────────────────────────────────────────────────────
  if ((item.avg_rating ?? 0) >= 4)               score += 1
  if (!item.flyer_image_url && !item.avg_rating) score -= 2

  return score
}

// ── "Why this is for you" label ───────────────────────────────────────────────
//
// Short pill-style labels — designed to be rendered as a small badge on cards.
// Intentionally terse and opinionated rather than long or generic.

export function reasonFor(item: Item, ctx: ScoreContext): string | null {
  const itemTags = (item.tags ?? []).map(t => t.toLowerCase())

  if (ctx.savedCatSet.has(item.category))        return 'matches your taste'
  if (ctx.clickedCatTop.has(item.category))       return "you're into this"
  if (item.subcategory && ctx.clickedSubTop.has(item.subcategory))
                                                   return 'your kind of vibe'

  const savedTag = itemTags.find(t => ctx.savedTagSet.has(t))
  if (savedTag) return `fits your "${savedTag.replace(/-/g, ' ')}" vibe`

  if (itemTags.some(t => ctx.clickedTagTop.has(t)))
                                                   return "you'd probably like this"

  if (item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h > 0 && h < 10)   return 'happening tonight'
    if (h >= 10 && h < 24) return 'happening today'
    if (h >= 24 && h < 48) return 'happening tomorrow'
  }

  if ((item.avg_rating ?? 0) >= 4 && (item.review_count ?? 0) >= 3)
                                                   return 'highly rated'

  if (item.created_at) {
    const d = (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
    if (d < 3) return 'just added'
  }

  return null
}

// ── Feed fetcher (shared async logic) ────────────────────────────────────────
//
// Used by both the homepage section and the /for-you page.
// Always returns results — falls back to recents when no interest data.

export async function fetchScoredFeed(
  ctx:       ScoreContext,
  savedTags: string[],
  limit:     number = 20,
): Promise<ScoredItem[]> {
  const params = new URLSearchParams({ sort: 'recent', limit: '60' })
  savedTags.slice(0, 6).forEach(t => params.append('tag', t))

  const [tagRes, recentRes] = await Promise.all([
    savedTags.length > 0 ? fetch(`/api/items?${params}`) : Promise.resolve(null),
    fetch('/api/items?sort=recent&limit=60'),
  ])

  const tagItems:    Item[] = tagRes?.ok   ? await tagRes.json()    : []
  const recentItems: Item[] = recentRes.ok ? await recentRes.json() : []

  const seen = new Set(tagItems.map(i => i.id))
  const all  = [...tagItems, ...recentItems.filter(i => !seen.has(i.id))]

  return all
    .map(item => ({
      item,
      score:  scoreItem(item, ctx),
      reason: reasonFor(item, ctx),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ── Top Pick + Backup Picks selector ─────────────────────────────────────────
//
// Produces a hierarchy: 1 Top Pick + up to `numBackups` Backup Picks.
//
// Rules applied in order:
//  1. Skip items whose IDs are in `seenIds` (cross-surface deduplication)
//  2. Pick the highest-scoring item as the Top Pick (no restrictions)
//  3. For Backup Picks: prefer items from different categories than the Top Pick
//     to avoid a wall of same-type items. Falls back to same-category if the
//     feed has no variety.
//
// This is a client-side reranking pass — it runs fast and never touches the DB.

export function pickTopAndBackups(
  scored:     ScoredItem[],
  seenIds:    Set<string> = new Set(),
  numBackups: number      = 2,
): TopPicks {
  const pool = scored.filter(s => !seenIds.has(s.item.id))
  if (pool.length === 0) return { top: null, backups: [] }

  const top = pool[0]

  // Prefer backups from different categories for visual diversity
  const usedCats   = new Set([top.item.category])
  const backups:   ScoredItem[] = []
  const sameCatQ:  ScoredItem[] = []

  for (const s of pool.slice(1)) {
    if (backups.length + sameCatQ.length >= numBackups * 4) break  // early exit
    if (!usedCats.has(s.item.category)) {
      backups.push(s)
      usedCats.add(s.item.category)
    } else {
      sameCatQ.push(s)
    }
    if (backups.length >= numBackups) break
  }

  // Fill remaining slots from same-category overflow
  for (const s of sameCatQ) {
    if (backups.length >= numBackups) break
    backups.push(s)
  }

  return { top, backups: backups.slice(0, numBackups) }
}
