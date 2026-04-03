// ── Theme definitions ─────────────────────────────────────────────────────────

export interface Theme {
  id: string
  name: string
  emoji: string
  description: string
  cost: number   // 0 = always unlocked / free
  preview: {
    bg: string
    accent: string
    text: string
    border: string
  }
}

export const THEMES: Theme[] = [
  {
    id: 'default',
    name: 'Default',
    emoji: '⚪',
    description: 'Clean and minimal',
    cost: 0,
    preview: { bg: '#FAFAFA', accent: '#111111', text: '#374151', border: '#E5E7EB' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    emoji: '🌅',
    description: 'Warm amber and orange tones',
    cost: 50,
    preview: { bg: '#FFF5EB', accent: '#EA580C', text: '#7C2D12', border: '#FED7AA' },
  },
  {
    id: 'forest',
    name: 'Forest',
    emoji: '🌿',
    description: 'Fresh greens and nature',
    cost: 75,
    preview: { bg: '#F0FDF4', accent: '#16A34A', text: '#14532D', border: '#BBF7D0' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    emoji: '🌙',
    description: 'Dark mode with indigo accents',
    cost: 100,
    preview: { bg: '#0F172A', accent: '#6366F1', text: '#E2E8F0', border: '#1E293B' },
  },
]

export const THEME_MAP = Object.fromEntries(THEMES.map((t) => [t.id, t]))

// ── Point rules ───────────────────────────────────────────────────────────────

export interface PointRule {
  type: string
  points: number
  label: string
  /** Award at most once per user, ever */
  oneTime?: boolean
  /** Max awards per calendar day (UTC) */
  dailyCap?: number
  /** Deduplicate by metadata.item_id — one award per item per user */
  dedupeByItem?: boolean
}

export const POINT_RULES: Record<string, PointRule> = {
  share_homepage: {
    type: 'share_homepage',
    points: 10,
    label: 'Shared NearU',
    oneTime: true,
  },
  share_event: {
    type: 'share_event',
    points: 5,
    label: 'Shared an event',
    dailyCap: 3,
    dedupeByItem: true,
  },
  save_item: {
    type: 'save_item',
    points: 2,
    label: 'Saved a listing',
    dailyCap: 10,
    dedupeByItem: true,
  },
  add_to_calendar: {
    type: 'add_to_calendar',
    points: 3,
    label: 'Added to calendar',
    dailyCap: 5,
    dedupeByItem: true,
  },
  post_review: {
    type: 'post_review',
    points: 5,
    label: 'Posted a review',
    dedupeByItem: true,
  },
  referral_signup: {
    type: 'referral_signup',
    points: 30,
    label: 'Referred a new user',
    // Deduped by metadata.referred_user_id in the API
  },
  unlock_theme: {
    type: 'unlock_theme',
    points: 0,        // negative (spending), handled specially
    label: 'Unlocked a theme',
  },
  unlock_pet: {
    type: 'unlock_pet',
    points: 0,        // negative (spending), handled by /api/pet unlock action
    label: 'Unlocked a pet',
  },
  buy_egg: {
    type: 'buy_egg',
    points: 0,        // negative (spending), handled by /api/pet buy_egg action
    label: 'Bought Pet Egg',
  },
  hatch_pet: {
    type: 'hatch_pet',
    points: 0,        // neutral record — no points awarded or deducted on hatch
    label: 'Hatched a companion',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function labelForType(type: string): string {
  return POINT_RULES[type]?.label ?? type.replace(/_/g, ' ')
}
