/**
 * lib/intent-parser.ts
 *
 * Rule-based natural-language intent parser for the NearU assistant.
 *
 * Converts a short free-text query into a structured ParsedIntent that the
 * recommendation engine can act on.  No network calls, no embeddings —
 * everything is local and synchronous.
 *
 * Designed to be swapped for an LLM-based parser later; the output shape
 * (ParsedIntent) is the stable API boundary.
 */

// ── Output type ───────────────────────────────────────────────────────────────

export interface ParsedIntent {
  /** Category slugs inferred from the query */
  categories:  string[]
  /** Tags to boost during scoring (derived from vibes + explicit tags) */
  tags:        string[]
  /** Category slugs to exclude from results */
  exclusions:  string[]
  /** Temporal preference */
  time:        'today' | 'tomorrow' | 'this-week' | null
  /** Budget constraint */
  budget:      'free' | null
  /** Location preference as a region slug */
  region:      'on-campus' | 'davis' | 'sacramento' | null
  /** Human-readable vibe labels (used for response generation) */
  vibes:       string[]
  /** True if we extracted at least one meaningful signal */
  matched:     boolean
}

// ── Vibe → scoring tag mapping ────────────────────────────────────────────────
//
// When the user expresses a vibe, we surface items tagged with these values.

const VIBE_TAGS: Record<string, string[]> = {
  chill:     ['outdoor', 'study-spot', 'coffee', 'quiet', 'cafe', 'peaceful'],
  quiet:     ['study-spot', 'library', 'coffee', 'quiet', 'cafe'],
  social:    ['social-party', 'student-friendly', 'bar', 'live-music', 'club'],
  fun:       ['social-party', 'student-friendly', 'live-music', 'sports', 'comedy'],
  outdoorsy: ['outdoor', 'park', 'trail', 'hiking', 'nature', 'campus'],
  romantic:  ['cafe', 'fine-dining', 'outdoor', 'date', 'wine'],
  cozy:      ['cafe', 'coffee', 'indoor', 'quiet', 'warm'],
  active:    ['sports', 'outdoor', 'hiking', 'fitness', 'rec'],
  artsy:     ['art', 'gallery', 'music', 'theatre', 'culture'],
}

// ── Keyword → category slug ───────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string> = {
  food:        'food',
  eat:         'food',
  eating:      'food',
  restaurant:  'food',
  restaurants: 'food',
  drink:       'food',
  drinks:      'food',
  coffee:      'food',
  cafe:        'food',
  cafes:       'food',
  boba:        'food',
  pizza:       'food',
  burger:      'food',
  tacos:       'food',
  ramen:       'food',
  sushi:       'food',
  lunch:       'food',
  dinner:      'food',
  brunch:      'food',
  breakfast:   'food',
  snack:       'food',
  snacks:      'food',
  event:       'events',
  events:      'events',
  concert:     'events',
  show:        'events',
  shows:       'events',
  performance: 'events',
  party:       'events',
  parties:     'events',
  festival:    'events',
  game:        'events',
  games:       'events',
  outdoor:     'outdoor',
  outdoors:    'outdoor',
  outside:     'outdoor',
  nature:      'outdoor',
  park:        'outdoor',
  parks:       'outdoor',
  hike:        'outdoor',
  hiking:      'outdoor',
  trail:       'outdoor',
  trails:      'outdoor',
  study:       'study',
  studying:    'study',
  library:     'study',
  workspace:   'study',
  workspaces:  'study',
  shop:        'shopping',
  shopping:    'shopping',
  store:       'shopping',
  stores:      'shopping',
  market:      'shopping',
  campus:      'campus',
}

// ── Internal helper ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseIntent(input: string): ParsedIntent {
  const text  = normalize(input)
  const words = text.split(' ').filter(Boolean)
  // Pad with spaces for reliable whole-word matching
  const phrase = ` ${text} `

  const result: ParsedIntent = {
    categories: [],
    tags:       [],
    exclusions: [],
    time:       null,
    budget:     null,
    region:     null,
    vibes:      [],
    matched:    false,
  }

  // ── 1. Exclusions ("not food", "no events", "without parties") ────────────
  const exclusionRe = /\b(?:not|no|without|except|avoid|skip)\s+(\w+)/g
  let em: RegExpExecArray | null
  while ((em = exclusionRe.exec(text)) !== null) {
    const excl = CATEGORY_KEYWORDS[em[1]]
    if (excl && !result.exclusions.includes(excl)) result.exclusions.push(excl)
  }

  // ── 2. Time ───────────────────────────────────────────────────────────────
  // Order matters: check most-specific first so "tonight" beats "this week", etc.
  if      (/\btonight\b|\btoday\b/.test(phrase))                                  result.time = 'today'
  else if (/\btomorrow\b|\btmr\b|\bnext\s+day\b/.test(phrase))                    result.time = 'tomorrow'
  else if (/\bthis\s+weekend\b|\bweekend\b|\bsaturday\b|\bsunday\b/.test(phrase)) result.time = 'this-week'
  else if (/\bthis\s+week\b|\bsoon\b|\bupcoming\b/.test(phrase))                  result.time = 'this-week'

  // ── 3. Budget ─────────────────────────────────────────────────────────────
  if (/\bfree\b/.test(phrase)) result.budget = 'free'

  // ── 4. Location ───────────────────────────────────────────────────────────
  if      (/\bnear\s+campus\b|\bon\s+campus\b|\bon-campus\b/.test(phrase)) result.region = 'on-campus'
  else if (/\bnearby\b|\bnear\s+me\b|\bclose\b/.test(phrase))              result.region = 'on-campus'
  else if (/\bdavis\b/.test(phrase))                                        result.region = 'davis'
  else if (/\bsacramento\b|\bsac\b/.test(phrase))                           result.region = 'sacramento'

  // ── 5. Vibes (whole-word) ─────────────────────────────────────────────────
  for (const [vibe, vibeTags] of Object.entries(VIBE_TAGS)) {
    // Match vibe as a whole word within the padded phrase
    const re = new RegExp(`\\b${vibe}\\b`)
    if (re.test(phrase)) {
      if (!result.vibes.includes(vibe)) result.vibes.push(vibe)
      for (const t of vibeTags) {
        if (!result.tags.includes(t)) result.tags.push(t)
      }
    }
  }

  // ── 6. Category keywords (whole-word) ─────────────────────────────────────
  for (const word of words) {
    const cat = CATEGORY_KEYWORDS[word]
    if (cat && !result.exclusions.includes(cat) && !result.categories.includes(cat)) {
      result.categories.push(cat)
    }
  }

  // ── 7. Budget → tag ───────────────────────────────────────────────────────
  if (result.budget === 'free' && !result.tags.includes('free')) {
    result.tags.push('free')
  }

  // ── 8. matched flag ───────────────────────────────────────────────────────
  result.matched =
    result.categories.length > 0 ||
    result.tags.length > 0 ||
    result.time !== null ||
    result.budget !== null ||
    result.region !== null ||
    result.vibes.length > 0

  return result
}

// ── Pet-voice response message ────────────────────────────────────────────────
//
// Produces a short, grounded assistant sentence from the parsed intent + count.

export function buildIntentResponse(intent: ParsedIntent, count: number): string {
  // Build a natural description of what was asked for
  const parts: string[] = []

  // Lead with vibe if present
  if (intent.vibes.includes('chill') || intent.vibes.includes('quiet'))   parts.push('something chill')
  else if (intent.vibes.includes('cozy'))                                  parts.push('a cozy spot')
  else if (intent.vibes.includes('social') || intent.vibes.includes('fun')) parts.push('something social')
  else if (intent.vibes.includes('outdoorsy'))                             parts.push('outdoor spots')
  else if (intent.vibes.includes('romantic'))                              parts.push('something romantic')
  else if (intent.vibes.includes('artsy'))                                 parts.push('something artsy')
  else if (intent.vibes.includes('active'))                                parts.push('something active')

  // Category if no vibe, or to add specificity
  if (intent.categories.length > 0 && parts.length === 0) {
    const cat = intent.categories[0]
    parts.push(cat === 'food' ? 'food spots' : cat)
  }

  // Modifiers
  if (intent.budget === 'free')          parts.push('free')
  if (intent.time === 'today')           parts.push('tonight')
  else if (intent.time === 'tomorrow')   parts.push('tomorrow')
  else if (intent.time === 'this-week')  parts.push('this weekend')
  if (intent.region === 'on-campus')     parts.push('near campus')
  else if (intent.region === 'davis')    parts.push('in Davis')
  else if (intent.region === 'sacramento') parts.push('in Sacramento')

  const what = parts.length > 0 ? parts.join(', ') : 'something for you'
  const cap  = what.charAt(0).toUpperCase() + what.slice(1)

  if (count === 0)  return `Looking for ${what}? Couldn't find a great match 🐾`
  if (count === 1)  return `${cap}? Found 1 that fits 🎯`
  return `${cap}? Found ${count} that fit 🎯`
}

// ── Supported intents (for documentation / hints) ────────────────────────────
//
// Exported for use in placeholder / tooltip copy.

export const INTENT_EXAMPLES = [
  '"chill tonight"',
  '"free food near campus"',
  '"something social this weekend"',
  '"coffee spot, not events"',
  '"outdoor, not food"',
] as const
