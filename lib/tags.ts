/**
 * Tag categorisation + styling utilities.
 * Used by ItemCard, listing detail page, and filter UI.
 */

// ── Semantic tag sets ─────────────────────────────────────────────────────────

export const CUISINE_TAGS = new Set([
  'thai', 'chinese', 'japanese', 'korean', 'vietnamese', 'indian', 'nepalese',
  'mediterranean', 'middle-eastern', 'italian', 'greek', 'french', 'spanish',
  'mexican', 'latin', 'american', 'british', 'irish', 'halal', 'kosher',
  'pizza', 'sushi', 'ramen', 'noodles', 'dumplings', 'cantonese', 'szechuan',
  'burgers', 'tacos', 'burritos', 'sandwiches', 'wraps', 'steakhouse',
  'seafood', 'bbq', 'vegan', 'vegetarian', 'farm-to-table', 'california-cuisine',
  'fast-food', 'fast-casual',
])

export const PRICE_TAGS = new Set([
  'free', 'cheap', 'cheap-eats', 'affordable', 'budget', 'moderate', 'expensive', 'splurge',
])

export const VIBE_TAGS = new Set([
  'study-friendly', 'late-night', 'group-friendly', 'quiet', 'cozy', 'lively',
  'outdoor-seating', 'dog-friendly', 'dogs-allowed', 'wifi', 'outlets',
  'student-friendly', 'family-friendly', 'date-night', 'solo-friendly',
  'live-music', 'sports-bar', 'rooftop',
])

export type TagCategory = 'cuisine' | 'price' | 'vibe' | 'other'

export function classifyTag(tag: string): TagCategory {
  const t = tag.toLowerCase()
  if (CUISINE_TAGS.has(t)) return 'cuisine'
  if (PRICE_TAGS.has(t))   return 'price'
  if (VIBE_TAGS.has(t))    return 'vibe'
  return 'other'
}

// ── Visual styles ─────────────────────────────────────────────────────────────

export const TAG_STYLE: Record<TagCategory, string> = {
  cuisine: 'bg-orange-50 text-orange-700 border border-orange-200',
  price:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  vibe:    'bg-blue-50 text-blue-700 border border-blue-200',
  other:   'bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]',
}

export function getTagStyle(tag: string): string {
  return TAG_STYLE[classifyTag(tag)]
}

// ── Human-readable labels ─────────────────────────────────────────────────────

const LABEL_OVERRIDES: Record<string, string> = {
  'cheap-eats':      'Cheap Eats',
  'fast-casual':     'Fast Casual',
  'fast-food':       'Fast Food',
  'farm-to-table':   'Farm to Table',
  'study-friendly':  'Study Friendly',
  'late-night':      'Late Night',
  'group-friendly':  'Group Friendly',
  'outdoor-seating': 'Outdoor Seating',
  'dog-friendly':    'Dog Friendly',
  'dogs-allowed':    'Dogs Allowed',
  'live-music':      'Live Music',
  'sports-bar':      'Sports Bar',
  'date-night':      'Date Night',
  'family-friendly': 'Family Friendly',
  'solo-friendly':   'Solo Friendly',
  'student-friendly': 'Student Friendly',
  'california-cuisine': 'California Cuisine',
  'middle-eastern':  'Middle Eastern',
  'on-campus':       'On Campus',
  'free-for-students': 'Free for Students',
  'wifi':            'WiFi',
  'vegan-options':   'Vegan Options',
  'vegetarian-options': 'Vegetarian Options',
}

export function tagLabel(tag: string): string {
  return LABEL_OVERRIDES[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1)
}

// ── Filter chip definitions (for UI) ─────────────────────────────────────────

export const CUISINE_FILTER_CHIPS = [
  { tag: 'thai',           label: '🍜 Thai' },
  { tag: 'chinese',        label: '🥢 Chinese' },
  { tag: 'japanese',       label: '🍱 Japanese' },
  { tag: 'vietnamese',     label: '🍲 Vietnamese' },
  { tag: 'mexican',        label: '🌮 Mexican' },
  { tag: 'indian',         label: '🍛 Indian' },
  { tag: 'italian',        label: '🍝 Italian' },
  { tag: 'mediterranean',  label: '🥗 Mediterranean' },
  { tag: 'american',       label: '🍔 American' },
  { tag: 'pizza',          label: '🍕 Pizza' },
]

export const VIBE_FILTER_CHIPS = [
  { tag: 'study-friendly',  label: '📚 Study Friendly' },
  { tag: 'student-friendly', label: '🎓 Student Friendly' },
  { tag: 'outdoor-seating', label: '🌿 Outdoor Seating' },
  { tag: 'late-night',      label: '🌙 Late Night' },
  { tag: 'group-friendly',  label: '👥 Group Friendly' },
  { tag: 'live-music',      label: '🎵 Live Music' },
]

export const PRICE_FILTER_CHIPS = [
  { tag: 'free',        label: '🆓 Free' },
  { tag: 'cheap',       label: '💰 Cheap' },
  { tag: 'cheap-eats',  label: '🍟 Cheap Eats' },
  { tag: 'moderate',    label: '💵 Moderate' },
]

// ── Derive "known for" line from tags ─────────────────────────────────────────

export function knownForFromTags(tags: string[]): string | null {
  const cuisines = tags.filter((t) => CUISINE_TAGS.has(t.toLowerCase()))
  const vibes    = tags.filter((t) => VIBE_TAGS.has(t.toLowerCase()) && t !== 'student-friendly')
  const parts: string[] = []
  if (cuisines.length > 0) parts.push(cuisines.slice(0, 2).map(tagLabel).join(', '))
  if (vibes.length > 0)    parts.push(vibes.slice(0, 2).map(tagLabel).join(', ').toLowerCase())
  return parts.length > 0 ? parts.join(' · ') : null
}
