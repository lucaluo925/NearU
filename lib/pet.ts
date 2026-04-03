// ── Pet types ─────────────────────────────────────────────────────────────────

export const PET_TYPES = [
  'dog', 'cat', 'bird', 'fox', 'bunny',
  'frog', 'panda', 'monkey', 'tiger',
] as const
export type PetType = (typeof PET_TYPES)[number]

export const PET_EMOJI: Record<PetType, string> = {
  dog:    '🐶',
  cat:    '🐱',
  bird:   '🐦',
  fox:    '🦊',
  bunny:  '🐰',
  frog:   '🐸',
  panda:  '🐼',
  monkey: '🐵',
  tiger:  '🐯',
}

export const PET_LABEL: Record<PetType, string> = {
  dog:    'Dog',
  cat:    'Cat',
  bird:   'Bird',
  fox:    'Fox',
  bunny:  'Bunny',
  frog:   'Frog',
  panda:  'Panda',
  monkey: 'Monkey',
  tiger:  'Tiger',
}

/** Points cost to buy a random-pet egg from the rewards shop. */
export const EGG_PRICE = 40

/**
 * Points required to unlock each pet directly (certainty path).
 * Dog (0) is the free starter — always unlocked.
 * Users can also get pets via egg hatch (surprise path, 40 pts).
 */
export const PET_PRICES: Record<PetType, number> = {
  dog:    0,
  cat:    50,
  bird:   70,
  fox:    100,
  bunny:  120,
  frog:   150,
  panda:  180,
  monkey: 220,
  tiger:  260,
}

// ── Mood ──────────────────────────────────────────────────────────────────────

export type PetMood = 'idle' | 'happy' | 'excited'

export const MOOD_EMOJI: Record<PetMood, string> = {
  idle:    '😐',
  happy:   '😊',
  excited: '😄',
}

export const MOOD_LABEL: Record<PetMood, string> = {
  idle:    'Idle',
  happy:   'Happy',
  excited: 'Excited',
}

/**
 * Compute mood from last_action_at timestamp.
 * excited  = action in last hour
 * happy    = action in last 24 hours
 * idle     = no action, or action >24h ago
 */
export function computeMood(lastActionAt: string | null | undefined): PetMood {
  if (!lastActionAt) return 'idle'
  const diffH = (Date.now() - new Date(lastActionAt).getTime()) / 3_600_000
  if (diffH < 1)  return 'excited'
  if (diffH < 24) return 'happy'
  return 'idle'
}

// ── Level ─────────────────────────────────────────────────────────────────────

/** Cumulative XP needed to reach each level (index = level - 1) */
export const LEVEL_XP_THRESHOLDS = [0, 20, 50] as const
export const MAX_LEVEL = 3

export function computeLevel(xp: number): number {
  if (xp >= LEVEL_XP_THRESHOLDS[2]) return 3
  if (xp >= LEVEL_XP_THRESHOLDS[1]) return 2
  return 1
}

export interface LevelProgress {
  current: number   // xp earned within this level
  needed: number    // xp needed to reach next level (0 if maxed)
  pct: number       // 0–100
  maxed: boolean
}

export function levelProgress(xp: number): LevelProgress {
  const level = computeLevel(xp)
  if (level >= MAX_LEVEL) {
    return { current: xp - LEVEL_XP_THRESHOLDS[2], needed: 0, pct: 100, maxed: true }
  }
  if (level === 2) {
    const base   = LEVEL_XP_THRESHOLDS[1]  // 20
    const target = LEVEL_XP_THRESHOLDS[2]  // 50
    const span   = target - base            // 30
    const done   = xp - base
    return { current: done, needed: span, pct: Math.round((done / span) * 100), maxed: false }
  }
  // level 1
  const target = LEVEL_XP_THRESHOLDS[1]  // 20
  return { current: xp, needed: target, pct: Math.round((xp / target) * 100), maxed: false }
}

// ── XP per action ─────────────────────────────────────────────────────────────

export const PET_XP_REWARDS: Record<string, number> = {
  save_item:       2,
  share:           3,
  add_to_calendar: 5,
}

// ── Rarity ────────────────────────────────────────────────────────────────────

export type PetRarity = 'common' | 'rare' | 'epic' | 'legendary'

export const PET_RARITY: Record<PetType, PetRarity> = {
  dog:    'common',
  bunny:  'common',
  bird:   'common',
  cat:    'rare',
  fox:    'rare',
  frog:   'rare',
  panda:  'epic',
  monkey: 'epic',
  tiger:  'legendary',
}

export const RARITY_LABEL: Record<PetRarity, string> = {
  common:    'Common',
  rare:      'Rare',
  epic:      'Epic',
  legendary: 'Legendary',
}

/** Tailwind-safe inline style values for each rarity tier. */
export const RARITY_COLORS: Record<PetRarity, { bg: string; text: string; border: string }> = {
  common:    { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' },
  rare:      { bg: '#EFF6FF', text: '#3B82F6', border: '#BFDBFE' },
  epic:      { bg: '#F5F3FF', text: '#8B5CF6', border: '#DDD6FE' },
  legendary: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
}

/**
 * Draw a random pet type from the rarity pool.
 * Probabilities: Common 65% · Rare 25% · Epic 8% · Legendary 2%
 * The first hatch is intentionally biased toward variety — any outcome
 * is usable and cute; Legendary is genuinely rare.
 */
export function drawHatch(): PetType {
  const n = Math.random() * 100
  if (n < 65) {
    const pool: PetType[] = ['dog', 'bunny', 'bird']
    return pool[Math.floor(Math.random() * pool.length)]
  }
  if (n < 90) {
    const pool: PetType[] = ['cat', 'fox', 'frog']
    return pool[Math.floor(Math.random() * pool.length)]
  }
  if (n < 98) {
    const pool: PetType[] = ['panda', 'monkey']
    return pool[Math.floor(Math.random() * pool.length)]
  }
  return 'tiger'
}
