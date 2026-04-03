// lib/trail-utils.ts
/**
 * Trail metadata utilities.
 * Trail data is encoded in known_for as "key:value" strings for outdoor items.
 * This avoids any DB migration.
 *
 * Example known_for for a trail:
 *   ["difficulty:Easy", "length:3.5 miles", "type:Loop", "elevation:100 ft", "duration:1 hour"]
 */

export interface TrailMeta {
  difficulty?:   string   // "Easy" | "Moderate" | "Hard" | "Expert"
  length?:       string   // "3.5 miles"
  elevation?:    string   // "100 ft"
  type?:         string   // "Loop" | "Out & Back" | "Point to Point"
  duration?:     string   // "1 hour" | "45 min"
  shade?:        string   // "Low" | "Medium" | "High"
}

/** Parse trail metadata from known_for array */
export function parseTrailMeta(knownFor: string[] | null | undefined): TrailMeta {
  const meta: TrailMeta = {}
  for (const entry of knownFor ?? []) {
    const colon = entry.indexOf(':')
    if (colon <= 0) continue
    const key = entry.slice(0, colon).trim().toLowerCase()
    const val = entry.slice(colon + 1).trim()
    if (!val) continue
    if (key === 'difficulty') meta.difficulty = val
    if (key === 'length')     meta.length     = val
    if (key === 'elevation')  meta.elevation  = val
    if (key === 'type')       meta.type       = val
    if (key === 'duration')   meta.duration   = val
    if (key === 'shade')      meta.shade      = val
  }
  return meta
}

/** Check if item has any trail metadata */
export function hasTrailMeta(knownFor: string[] | null | undefined): boolean {
  return (knownFor ?? []).some((k) => k.includes(':'))
}

/** Difficulty badge color */
export function difficultyColor(difficulty: string): string {
  const d = difficulty.toLowerCase()
  if (d === 'easy')     return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (d === 'moderate') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (d === 'hard')     return 'bg-red-50 text-red-700 border-red-200'
  if (d === 'expert')   return 'bg-purple-50 text-purple-700 border-purple-200'
  return 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]'
}

/** Derive a recommendation label from trail meta + tags */
export function trailRecommendationLabel(
  meta: TrailMeta,
  tags: string[],
): string | null {
  const tagsLower = tags.map((t) => t.toLowerCase())
  const isDogFriendly  = tagsLower.some((t) => t.includes('dog'))
  const isBikeFriendly = tagsLower.some((t) => t.includes('bike') || t.includes('cycling'))
  const isBirds        = tagsLower.some((t) => t.includes('bird'))
  const isScenic       = tagsLower.some((t) => t.includes('scenic') || t.includes('view'))
  const isSwimming     = tagsLower.some((t) => t.includes('swim'))

  if (meta.difficulty === 'Easy' && meta.length && parseFloat(meta.length) <= 2)
    return 'Quick Escape'
  if (meta.difficulty === 'Easy')     return 'Beginner Friendly'
  if (meta.difficulty === 'Moderate') return 'Scenic Pick'
  if (meta.difficulty === 'Hard')     return 'Challenge Trail'
  if (isBikeFriendly)                 return 'Bike Friendly'
  if (isDogFriendly)                  return 'Dog Friendly'
  if (isBirds)                        return 'Birdwatching'
  if (isScenic)                       return 'Scenic Pick'
  if (isSwimming)                     return 'Swimming Spot'
  return null
}
