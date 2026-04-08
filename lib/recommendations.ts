/**
 * lib/recommendations.ts
 *
 * Pure, shared recommendation utilities.
 * No React, no side-effects — safe to import in client and server contexts.
 *
 * Used by:
 *   - components/HomePersonalization.tsx  (homepage For You section)
 *   - app/for-you/ForYouClient.tsx        (/for-you page)
 *
 * Scoring model v2 — key improvements over v1
 * ────────────────────────────────────────────
 * 1. Click-magnitude scaling: behavioral bonuses scale with click intensity
 *    (how dominant a category is in the user's history), not just presence
 *    in the top-3.  A category clicked 2 times gives a weaker signal than one
 *    clicked 20 times.
 *
 * 2. Recency window (recentCatSet): categories from the user's last 10 clicks
 *    get an extra +3 bonus, letting taste shifts surface within the same
 *    session rather than waiting for aggregate counts to catch up.
 *
 * 3. Temporal precision: imminently starting events (+6) are now sharply
 *    favoured over "sometime this week" (+1), and past events are penalised
 *    (-8) so stale content never surfaces.
 *
 * 4. Geo scoring: haversineKm() measures distance from UC Davis.  Items
 *    within walking distance (+3) or biking distance (+2) score higher.
 *    Very distant items (>50 km) are penalised.
 *
 * 5. Staleness penalty: listings with no start_time older than 14+ days
 *    get a -1/-2 penalty so the feed doesn't surface stale evergreen content.
 *
 * 6. Richer quality signal: avg_rating × review_count gate (+3 for ≥4.5★
 *    with ≥5 reviews, vs a flat +1 in v1).
 *
 * 7. rerankForDiversity(): post-score pass that enforces category and venue
 *    diversity in the top results, so the feed doesn't feel like a wall of
 *    the same type/place.
 *
 * 8. Specific reasonFor() labels: "starts in 12m", "on campus", "4.8★ · 14
 *    reviews", "you've been exploring this" — informative rather than generic.
 */

import type { Item }           from '@/lib/types'
import type { TasteProfile }   from '@/hooks/useTasteProfile'
import type { InterestsStore } from '@/hooks/useInterests'
import { topNKeys }            from '@/hooks/useTasteProfile'
import { UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'

// ── Geo helper ────────────────────────────────────────────────────────────────
//
// Haversine great-circle distance in kilometres.
// Exported so chip-filter helpers in components can reuse without duplicating.

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 6371
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * (Math.PI / 180))
             * Math.cos(lat2 * (Math.PI / 180))
             * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Internal time formatter ───────────────────────────────────────────────────

function fmtHour(iso: string): string {
  const d    = new Date(iso)
  const h    = d.getHours()
  const m    = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12  = h % 12 || 12
  return m === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

// ── Score context ─────────────────────────────────────────────────────────────

export interface ScoreContext {
  /** Tags the user explicitly saved (cuisines, vibes, prices) */
  savedTagSet:    Set<string>
  /** Categories the user explicitly saved */
  savedCatSet:    Set<string>
  /** Top-3 categories by all-time click count */
  clickedCatTop:  Set<string>
  /** Top-3 subcategories by all-time click count */
  clickedSubTop:  Set<string>
  /** Top-10 tags by all-time click count */
  clickedTagTop:  Set<string>
  /**
   * Categories in the user's last 10 clicks (recency window).
   * Detects taste shifts faster than aggregate top-3.
   */
  recentCatSet:   Set<string>
  /**
   * Per-category click intensity, normalised to 0–1.
   * Full intensity (1.0) when a category = ≥30% of all clicks.
   * Scales behavioral bonuses: frequently-visited categories earn higher scores.
   */
  clickMag:       Record<string, number>
  /**
   * Total click count from profile — used to gate the novelty exploration
   * boost.  We only nudge discovery when the user has meaningful history;
   * new users haven't expressed preferences yet so the boost would be noise.
   */
  totalClicks:    number
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
  recentCatSet:  new Set(),
  clickMag:      {},
  totalClicks:   0,
}

export function buildScoreContext(
  interests: InterestsStore,
  profile:   TasteProfile,
): ScoreContext {
  // Normalise click magnitude per category (0–1).
  // Threshold: 30% of total clicks = full intensity (1.0).
  // Example: food clicked 15/50 times → 15/(50×0.3) = 1.0 (capped).
  const totalClicks = Math.max(profile.totalClicks, 1)
  const clickMag: Record<string, number> = {}
  for (const [cat, count] of Object.entries(profile.categoryCounts)) {
    clickMag[cat] = Math.min(count / Math.max(totalClicks * 0.3, 5), 1)
  }

  return {
    savedTagSet:   new Set(
      [...interests.cuisines, ...interests.vibes, ...interests.prices]
        .map(t => t.toLowerCase()),
    ),
    savedCatSet:   new Set(interests.categories),
    clickedCatTop: new Set(topNKeys(profile.categoryCounts, 3)),
    clickedSubTop: new Set(topNKeys(profile.subcategoryCounts, 3)),
    clickedTagTop: new Set(topNKeys(profile.tagCounts, 10)),
    recentCatSet:  new Set((profile.recentCategories ?? []).slice(0, 10)),
    clickMag,
    totalClicks:   profile.totalClicks,
  }
}

// ── Multi-signal scorer ───────────────────────────────────────────────────────
//
//  Behavioural (strongest signals — explicit preference or repeated behavior):
//    +4–7  saved favourite category    (base +4, scales to +7 at full click-mag)
//    +3–5  frequently-clicked category (base +3, scales to +5 at full click-mag)
//    +3    category in recency window  (last 10 clicks — captures taste shifts)
//    +2    frequently-clicked subcategory
//    +2×N  matching saved tag          (capped at 3 tags → max +6)
//    +1×N  matching clicked tag        (capped at 3 tags → max +3)
//
//  Temporal:
//    +6    start_time within next 3 h  (imminent — maximum urgency)
//    +4    start_time within 3–12 h    (today, afternoon/evening)
//    +2    start_time within 12–24 h   (tonight)
//    +1    start_time within 7 days    (this week)
//    −3    ended < 3 h ago             (just missed; still context-useful)
//    −8    ended ≥ 3 h ago             (stale past event; suppress strongly)
//
//  Geo:
//    +2    campus category or on-campus/near-campus tag
//    +3    within 0.5 km of UC Davis   (walking distance)
//    +2    within 2 km of UC Davis     (biking distance)
//    +1    within 5 km of UC Davis     (in Davis)
//    −2    >50 km from UC Davis        (Sacramento/Bay Area — less relevant)
//
//  Freshness / staleness:
//    +2    created < 3 days ago
//    +1    created < 7 days ago
//    −1    created > 14 days AND no start_time (stale evergreen listing)
//    −2    created > 30 days AND no start_time (very stale listing)
//
//  Quality:
//    +3    avg_rating ≥ 4.5 AND review_count ≥ 5 (high-quality with social proof)
//    +1    avg_rating ≥ 4.0 AND review_count ≥ 3
//    −2    no image AND no rating (low-quality placeholder listing)

export function scoreItem(item: Item, ctx: ScoreContext): number {
  let score    = 0
  const tags   = (item.tags ?? []).map(t => t.toLowerCase())
  const now    = Date.now()

  // ── Behavioural ──────────────────────────────────────────────────────────────
  const mag = ctx.clickMag[item.category] ?? 0

  if (ctx.savedCatSet.has(item.category)) {
    // Explicit preference: base +4, up to +7 when click-magnitude confirms it.
    // Magnitude bonus prevents onboarding selections that were never revisited
    // from scoring the same as genuinely active preferences.
    score += 4 + Math.round(mag * 3)
  } else if (ctx.clickedCatTop.has(item.category)) {
    // Implicit preference: base +3, up to +5.
    score += 3 + Math.round(mag * 2)
  }

  // Recency: category clicked in the last 10 sessions → active current interest.
  // This lets "you switched to events this week" surface before aggregate counts catch up.
  if (ctx.recentCatSet.has(item.category)) score += 3

  if (item.subcategory && ctx.clickedSubTop.has(item.subcategory)) score += 2

  // Tag matching — capped per signal to prevent runaway scores on tag-heavy items
  const savedTagMatches   = tags.filter(t => ctx.savedTagSet.has(t))
  const clickedTagMatches = tags.filter(t => ctx.clickedTagTop.has(t))
  score += Math.min(savedTagMatches.length,   3) * 2   // max +6
  score += Math.min(clickedTagMatches.length, 3)       // max +3

  // ── Temporal ─────────────────────────────────────────────────────────────────
  if (item.start_time) {
    const h = (new Date(item.start_time).getTime() - now) / 3_600_000
    if      (h > 0  && h <= 3)    score += 6   // starting imminently
    else if (h > 0  && h <= 12)   score += 4   // later today
    else if (h > 0  && h <= 24)   score += 2   // tonight
    else if (h > 0  && h <= 168)  score += 1   // this week
    else if (h < 0  && h > -3)    score -= 3   // just ended (may still be relevant)
    else if (h <= -3)              score -= 8   // stale past event — suppress strongly
  }

  // ── Geo / campus proximity ───────────────────────────────────────────────────
  if (item.category === 'campus') score += 2
  if (tags.some(t => t === 'on-campus' || t === 'near-campus')) score += 2

  if (item.latitude != null && item.longitude != null) {
    const km = haversineKm(UC_DAVIS_LAT, UC_DAVIS_LNG, item.latitude, item.longitude)
    if      (km <  0.5) score += 3   // walking distance from campus
    else if (km <  2)   score += 2   // biking distance (typical Davis range)
    else if (km <  5)   score += 1   // in Davis
    else if (km > 50)   score -= 2   // Sacramento / Bay Area — low relevance
  }

  // ── Freshness / staleness ────────────────────────────────────────────────────
  if (item.created_at) {
    const d = (now - new Date(item.created_at).getTime()) / 86_400_000
    if      (d < 3)                          score += 2
    else if (d < 7)                          score += 1
    else if (d > 30 && !item.start_time)     score -= 2
    else if (d > 14 && !item.start_time)     score -= 1
  }

  // ── Quality ──────────────────────────────────────────────────────────────────
  const rating  = item.avg_rating   ?? 0
  const reviews = item.review_count ?? 0
  if      (rating >= 4.5 && reviews >= 5) score += 3
  else if (rating >= 4.0 && reviews >= 3) score += 1
  if (!item.flyer_image_url && !item.avg_rating) score -= 2

  // ── Novelty / exploration ────────────────────────────────────────────────────
  //
  // Give a small lift to items in categories the user has never clicked.
  // This prevents the feed from becoming a pure echo chamber once a user has
  // established preferences — a chill/study user occasionally sees events, etc.
  //
  // Conditions before applying:
  //   1. User has meaningful click history (>5) — avoids noise at onboarding.
  //   2. Category was never clicked (mag === 0 and not in clickedCatTop).
  //   3. Category is not an explicit saved interest (that's a different signal).
  //
  // The +2 lift is intentionally small: just enough to bubble up one or two
  // unexplored items when their base scores are close to in-preference items.
  // Strong behavioral signals (+7 max) still dominate.
  if (
    ctx.totalClicks > 5 &&
    mag === 0 &&
    !ctx.clickedCatTop.has(item.category) &&
    !ctx.savedCatSet.has(item.category)
  ) {
    score += 2
  }

  return score
}

// ── "Why this is for you" label ───────────────────────────────────────────────
//
// Concise, data-driven labels — specific enough to feel informative,
// short enough to fit in a single pill.
//
// Priority order:
//   1. Temporal  — most actionable: "starts in 12m", "today · 7pm"
//   2. Geo       — location-specific: "on campus", "close to campus"
//   3. Behaviour — personalised: "you've been exploring this", "4.8★ · 12 reviews"
//   4. Freshness — "just added" as a last resort

export function reasonFor(item: Item, ctx: ScoreContext): string | null {
  const tags = (item.tags ?? []).map(t => t.toLowerCase())
  const now  = Date.now()

  // ── Temporal ─────────────────────────────────────────────────────────────────
  if (item.start_time) {
    const h = (new Date(item.start_time).getTime() - now) / 3_600_000
    if (h > 0 && h <= 1)  return `starts in ${Math.round(h * 60)}m`
    if (h > 0 && h <= 6)  return `starts soon · ${fmtHour(item.start_time)}`
    if (h > 0 && h <= 24) return `today · ${fmtHour(item.start_time)}`
    if (h > 0 && h <= 48) return 'happening tomorrow'
  }

  // ── Geo ───────────────────────────────────────────────────────────────────────
  if (item.latitude != null && item.longitude != null) {
    const km = haversineKm(UC_DAVIS_LAT, UC_DAVIS_LNG, item.latitude, item.longitude)
    if (km < 0.5) return 'on campus'
    if (km < 2)   return 'close to campus'
  }
  if (tags.includes('on-campus'))   return 'on campus'
  if (tags.includes('near-campus')) return 'close to campus'

  // ── Behavioural ───────────────────────────────────────────────────────────────
  if (ctx.savedCatSet.has(item.category)) {
    const savedTag = tags.find(t => ctx.savedTagSet.has(t))
    if (savedTag) return 'similar to what you saved'
    return 'matches your taste'
  }

  if (ctx.recentCatSet.has(item.category)) return "you've been exploring this"
  if (ctx.clickedCatTop.has(item.category)) return "you're into this"
  if (item.subcategory && ctx.clickedSubTop.has(item.subcategory)) return 'your kind of vibe'

  const savedTag = tags.find(t => ctx.savedTagSet.has(t))
  if (savedTag) return `saved: ${savedTag.replace(/-/g, ' ')}`

  if (tags.some(t => ctx.clickedTagTop.has(t))) return "you'd probably like this"

  // ── Quality ───────────────────────────────────────────────────────────────────
  const rating  = item.avg_rating   ?? 0
  const reviews = item.review_count ?? 0
  if (rating >= 4.5 && reviews >= 5) return `${rating.toFixed(1)}★ · ${reviews} reviews`
  if (rating >= 4.0 && reviews >= 3) return `${rating.toFixed(1)}★ rated`

  // ── Freshness ─────────────────────────────────────────────────────────────────
  if (item.created_at) {
    const d = (now - new Date(item.created_at).getTime()) / 86_400_000
    if (d < 3) return 'just added'
  }

  return null
}

// ── Diversity reranker ────────────────────────────────────────────────────────
//
// Post-score pass that prevents the top of the feed from feeling like a wall
// of the same category or the same venue.
//
// Algorithm:
//   Walk score-sorted input.  Accept an item if its category count is below
//   maxPerCategory AND its venue (location_name) hasn't been seen yet.
//   Defer rejected items to an overflow queue appended after the diverse set.
//
//   Score ordering is preserved within each acceptance group — personalisation
//   is not sacrificed, just gently constrained.

export function rerankForDiversity(
  scored:         ScoredItem[],
  maxPerCategory: number = 2,
  maxPerVenue:    number = 1,
): ScoredItem[] {
  const catCounts: Record<string, number> = {}
  const venuesSeen = new Set<string>()
  const result:    ScoredItem[] = []
  const overflow:  ScoredItem[] = []

  for (const s of scored) {
    const cat   = s.item.category
    const venue = s.item.location_name?.toLowerCase().trim()

    const catCount = catCounts[cat] ?? 0
    const venueOk  = !venue || !venuesSeen.has(venue)

    if (catCount < maxPerCategory && venueOk) {
      result.push(s)
      catCounts[cat] = catCount + 1
      if (venue) venuesSeen.add(venue)
    } else {
      overflow.push(s)
    }
  }

  return [...result, ...overflow]
}

// ── Feed fetcher (shared async logic) ────────────────────────────────────────
//
// Used by both the homepage section and the /for-you page.
// Always returns results — falls back to recents when no interest data.
//
// Candidate pool diversity strategy (v3)
// ───────────────────────────────────────
// The old approach (tag-filtered + recent) was vulnerable to pool concentration:
// if a batch of food items was recently imported, they dominated the 60-item pool
// before scoring ran, so scoring + diversity-reranking couldn't fix the skew.
//
// Now we fan out into parallel per-category fetches, guaranteeing cross-category
// representation in the candidate pool regardless of what was recently imported:
//
//   1. Tag-filtered fetch  — user's explicit saved interests (strongest signal)
//   2. Recent fetch        — time-ordered fallback (catches new content quickly)
//   3. Behavioral-cat fetches (×2) — user's top 2 clicked categories explicitly
//                            fetched so they're never crowded out by batch imports
//   4. Discovery fetch     — ONE unexplored category (not in user's top-3 or saved
//                            interests) to prevent echo-chamber lock-in
//
// All batches are merged with a dedup pass (first-seen wins to preserve priority
// order), then scored and ranked.  The scorer + rerankForDiversity handle the
// final ordering.

/** Fetch items from the API, returning [] on any network or status error. */
async function safeFetch(url: string): Promise<Item[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    return res.json() as Promise<Item[]>
  } catch {
    return []
  }
}

/** All known category slugs — used for discovery fetch selection. */
const ALL_CATEGORY_SLUGS = ['events', 'food', 'outdoor', 'study', 'shopping', 'campus'] as const

export async function fetchScoredFeed(
  ctx:       ScoreContext,
  savedTags: string[],
  limit:     number = 20,
): Promise<ScoredItem[]> {
  const fetches: Promise<Item[]>[] = []

  // 1. Tag-filtered fetch — user's explicit interests (up to 6 tags)
  if (savedTags.length > 0) {
    const params = new URLSearchParams({ sort: 'recent', limit: '30' })
    savedTags.slice(0, 6).forEach(t => params.append('tag', t))
    fetches.push(safeFetch(`/api/items?${params}`))
  }

  // 2. Recent fetch — catches freshly submitted content regardless of category
  fetches.push(safeFetch('/api/items?sort=recent&limit=40'))

  // 3. Per-category behavioral fetches — explicitly pull the user's top 2
  //    clicked categories so a skewed recent batch can't crowd them out.
  //    Capped at 20 items each — enough for scoring diversity without overloading.
  const topBehavioralCats = [...ctx.clickedCatTop].slice(0, 2)
  for (const cat of topBehavioralCats) {
    fetches.push(safeFetch(`/api/items?category=${cat}&sort=recent&limit=20`))
  }

  // 4. Discovery fetch — one under-explored category per session-day.
  //    Only activates when the user has enough click history to have established
  //    preferences (>5 clicks).  Uses a stable per-day index so the discovery
  //    category doesn't flicker on every render but rotates daily.
  if (ctx.totalClicks > 5) {
    const unexplored = ALL_CATEGORY_SLUGS.filter(
      c => !ctx.clickedCatTop.has(c) && !ctx.savedCatSet.has(c),
    )
    if (unexplored.length > 0) {
      const dayIndex = Math.floor(Date.now() / 86_400_000)
      const discoveryCat = unexplored[dayIndex % unexplored.length]
      fetches.push(safeFetch(`/api/items?category=${discoveryCat}&sort=recent&limit=15`))
    }
  }

  // Merge all batches — first-seen wins (preserves priority order across batches)
  const batches = await Promise.all(fetches)
  const seenIds = new Set<string>()
  const all: Item[] = []
  for (const batch of batches) {
    for (const item of batch) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        all.push(item)
      }
    }
  }

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
// Three-pass algorithm:
//   Pass 1 — Remove session-seen items (cross-surface deduplication).
//   Pass 2 — Diversity reranking: prevent category/venue clusters at the top.
//   Pass 3 — Pick highest-scoring as Top Pick; fill backups preferring
//             different categories AND different venues.  Falls back to
//             same-category/venue if the feed lacks variety.

export function pickTopAndBackups(
  scored:     ScoredItem[],
  seenIds:    Set<string> = new Set(),
  numBackups: number      = 2,
): TopPicks {
  // Pass 1: filter out items shown on other surfaces this session
  const pool = scored.filter(s => !seenIds.has(s.item.id))
  if (pool.length === 0) return { top: null, backups: [] }

  // Pass 2: diversity reranking (max 2 per category, 1 per venue)
  const reranked = rerankForDiversity(pool, 2, 1)

  const top        = reranked[0]
  const usedCats   = new Set([top.item.category])
  const usedVenues = new Set(
    top.item.location_name ? [top.item.location_name.toLowerCase().trim()] : [],
  )

  // Pass 3: fill backups with category + venue diversity
  const backups:  ScoredItem[] = []
  const sameCatQ: ScoredItem[] = []   // overflow for same-category items

  for (const s of reranked.slice(1)) {
    if (backups.length >= numBackups) break
    const venue   = s.item.location_name?.toLowerCase().trim()
    const venueOk = !venue || !usedVenues.has(venue)

    if (!usedCats.has(s.item.category) && venueOk) {
      backups.push(s)
      usedCats.add(s.item.category)
      if (venue) usedVenues.add(venue)
    } else {
      sameCatQ.push(s)
    }
  }

  // Fill remaining slots from same-category overflow (venue dedup still applied)
  for (const s of sameCatQ) {
    if (backups.length >= numBackups) break
    const venue = s.item.location_name?.toLowerCase().trim()
    if (!venue || !usedVenues.has(venue)) {
      backups.push(s)
      if (venue) usedVenues.add(venue)
    }
  }

  return { top, backups: backups.slice(0, numBackups) }
}

// ── Impression-frequency penalty ─────────────────────────────────────────────
//
// Items the user has seen multiple times without clicking are over-shown.
// Applying a score penalty pushes them down the ranking so the feed
// refreshes naturally rather than surfacing the same high-scoring items
// every time the user returns to the page.
//
// Usage:
//   const overshown = getOvershownIds(3)   // from lib/session-seen
//   const penalised = applyImpressionPenalty(scored, overshown)
//   // then pass penalised into pickTopAndBackups / rerankForDiversity
//
// Penalty of 4 is calibrated to be:
//   - Large enough to displace items below most behaviorally-matched content
//   - Small enough that a genuinely high-rated or imminent item still surfaces
//     even if it was previously shown (e.g. an event starting in 30m scores +6)

export function applyImpressionPenalty(
  scored:       ScoredItem[],
  overshownIds: Set<string>,
  penalty:      number = 4,
): ScoredItem[] {
  if (overshownIds.size === 0) return scored
  return scored
    .map(s =>
      overshownIds.has(s.item.id)
        ? { ...s, score: s.score - penalty }
        : s,
    )
    .sort((a, b) => b.score - a.score)
}
