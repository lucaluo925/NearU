'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePet } from '@/hooks/usePet'
import { useToast } from '@/components/Toast'
import { CATEGORIES } from '@/lib/constants'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import {
  PET_TYPES, PET_EMOJI, PET_LABEL, PET_PRICES, EGG_PRICE, MOOD_EMOJI, MOOD_LABEL,
  PET_RARITY, RARITY_LABEL, RARITY_COLORS, drawHatch,
  levelProgress, computeLevel,
  type PetType, type PetMood, type PetRarity,
} from '@/lib/pet'

// ── Utility ───────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Bond store ────────────────────────────────────────────────────────────────

const BOND_KEY    = 'nearu-pet-bond'
const GREETED_KEY = 'nearu-pet-greeted'
const NAME_KEY    = 'nearu-pet-name'
const HATCHED_KEY = 'nearu-hatched'

function loadBond(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(BOND_KEY) ?? '0', 10) || 0) }
  catch { return 0 }
}

function bumpBond(n: number): number {
  const next = Math.max(0, loadBond() + n)
  try { localStorage.setItem(BOND_KEY, String(next)) } catch {}
  return next
}

function loadPetName(): string | null {
  try { return localStorage.getItem(NAME_KEY) ?? null } catch { return null }
}

function savePetName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim()) } catch {}
}

// ── Return detection store ────────────────────────────────────────────────────

const LAST_VISIT_KEY = 'nearu-last-visit'

function loadLastVisit(): number {
  try { return parseInt(localStorage.getItem(LAST_VISIT_KEY) ?? '0', 10) || 0 }
  catch { return 0 }
}

function updateLastVisit(): void {
  try { localStorage.setItem(LAST_VISIT_KEY, String(Date.now())) } catch {}
}

// ── Guest state (localStorage, no auth required) ─────────────────────────────
// Lets logged-out users accumulate a lightweight bond with the pet across
// page reloads.  Completely safe to ignore if localStorage is unavailable.

const GUEST_BOND_KEY    = 'nearu-guest-bond'
const GUEST_ACTIONS_KEY = 'nearu-guest-actions'
const GUEST_LAST_KEY    = 'nearu-guest-last-action'
const GUEST_NAME_KEY    = 'nearu-guest-name'
const GUEST_TAPS_KEY    = 'nearu-guest-taps'

function loadGuestBond(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(GUEST_BOND_KEY) ?? '0', 10) || 0) }
  catch { return 0 }
}
function bumpGuestBond(n: number): number {
  const next = Math.min(99, loadGuestBond() + n)
  try { localStorage.setItem(GUEST_BOND_KEY, String(next)) } catch {}
  return next
}
function loadGuestActions(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(GUEST_ACTIONS_KEY) ?? '0', 10) || 0) }
  catch { return 0 }
}
function bumpGuestActions(): void {
  try { localStorage.setItem(GUEST_ACTIONS_KEY, String(Math.min(999, loadGuestActions() + 1))) } catch {}
}
function loadGuestLastAction(): number {
  try { return parseInt(localStorage.getItem(GUEST_LAST_KEY) ?? '0', 10) || 0 }
  catch { return 0 }
}
function touchGuestLastAction(): void {
  try { localStorage.setItem(GUEST_LAST_KEY, String(Date.now())) } catch {}
}
function loadGuestTaps(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(GUEST_TAPS_KEY) ?? '0', 10) || 0) }
  catch { return 0 }
}
function bumpGuestTaps(): void {
  try { localStorage.setItem(GUEST_TAPS_KEY, String(Math.min(999, loadGuestTaps() + 1))) } catch {}
}
/** Called once on first sign-in to clear ephemeral guest progress. */
function clearGuestState(): void {
  try {
    localStorage.removeItem(GUEST_BOND_KEY)
    localStorage.removeItem(GUEST_ACTIONS_KEY)
    localStorage.removeItem(GUEST_LAST_KEY)
    localStorage.removeItem(GUEST_NAME_KEY)
    localStorage.removeItem(GUEST_TAPS_KEY)
  } catch {}
}

// ── Persistent message + chat history (cross-component coherence) ─────────────
// Last meaningful pet message (save/share/calendar reaction) is stored so the
// modal can show it even after the floating speech bubble has dismissed.
// Chat history mirrors the nearu-pet-chat key used by HomePersonalization.

const LAST_MSG_KEY     = 'nearu-pet-last-message'
const CHAT_HISTORY_KEY = 'nearu-pet-chat'
const CHAT_MAX_ENTRIES = 20

interface PersistedMsg {
  text:          string
  ts:            number
  itemId?:       string | null
  itemTitle?:    string | null
  itemCategory?: string | null
}

function loadLastMsg(): PersistedMsg | null {
  try { const raw = localStorage.getItem(LAST_MSG_KEY); return raw ? JSON.parse(raw) : null }
  catch { return null }
}
function saveLastMsg(msg: PersistedMsg): void {
  try { localStorage.setItem(LAST_MSG_KEY, JSON.stringify(msg)) } catch {}
}

/** Read the current listing's context written by ViewTracker. */
function loadPetContext(): { itemId: string; itemTitle: string | null; itemCategory: string } | null {
  try { const raw = localStorage.getItem('nearu-pet-context'); return raw ? JSON.parse(raw) : null }
  catch { return null }
}

/** Append an action-triggered message to the shared chat history (same format as HomePersonalization). */
function appendToChatHistory(
  text: string,
  items: { id: string; title: string; category: string; flyer_image_url?: string | null }[],
): void {
  try {
    const raw      = localStorage.getItem(CHAT_HISTORY_KEY)
    const existing = raw ? (JSON.parse(raw)?.messages ?? []) : []
    const updated  = [{ text, items, ts: Date.now() }, ...existing].slice(0, CHAT_MAX_ENTRIES)
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify({ messages: updated }))
  } catch {}
}

// ── Engagement signals ────────────────────────────────────────────────────────
// Lightweight cross-session counters for feedback + chip interactions.
// Read by recommendation scorer to slightly bias results toward engaged categories.

const ENGAGEMENT_KEY = 'nearu-pet-engagement'
interface EngagementSignals { moreLikeThis: number; chipClicks: number; modalOpens: number }

function loadEngagement(): EngagementSignals {
  try {
    const raw = localStorage.getItem(ENGAGEMENT_KEY)
    return raw ? { moreLikeThis: 0, chipClicks: 0, modalOpens: 0, ...JSON.parse(raw) }
              : { moreLikeThis: 0, chipClicks: 0, modalOpens: 0 }
  } catch { return { moreLikeThis: 0, chipClicks: 0, modalOpens: 0 } }
}
function bumpEngagement(field: keyof EngagementSignals): void {
  try {
    const cur = loadEngagement()
    cur[field] = (cur[field] ?? 0) + 1
    localStorage.setItem(ENGAGEMENT_KEY, JSON.stringify(cur))
  } catch {}
}

// ── Guest name (optional, lightweight) ───────────────────────────────────────

function loadGuestName(): string | null {
  try {
    const raw = localStorage.getItem(GUEST_NAME_KEY)
    if (!raw) return null
    const trimmed = raw.trim()
    return trimmed.length >= 1 && trimmed.length <= 20 ? trimmed : null
  } catch { return null }
}

function saveGuestName(name: string): void {
  try {
    const trimmed = name.trim().slice(0, 20)
    if (trimmed) localStorage.setItem(GUEST_NAME_KEY, trimmed)
  } catch {}
}

// ── Behavior memory ───────────────────────────────────────────────────────────

const CAT_SIGNAL_KEY  = 'nearu-cat-signal'
const SAVED_STORE_KEY = 'aggie-map-favorites-v2'

function loadCatSignal(): string[] {
  try {
    const raw = localStorage.getItem(CAT_SIGNAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch { return [] }
}

function loadSavedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_STORE_KEY)
    if (!raw) return new Set()
    const store = JSON.parse(raw) as { itemCollections?: Record<string, string> }
    return new Set(Object.keys(store?.itemCollections ?? {}))
  } catch { return new Set() }
}

/** Per-category observational lines — specific enough to feel real, not generic. */
const CAT_MEMORY_MSGS: Record<string, readonly string[]> = {
  food:     [
    "you really like food spots ☕",
    "you keep finding good places to eat",
    "always looking for food… I see you 🍜",
    "you've been into food lately — fair enough",
  ],
  events:   [
    "you've been into live events lately 🎉",
    "you love a good event",
    "always hunting for something fun 👀",
    "you don't miss much, do you",
  ],
  outdoor:  [
    "you really like outdoor spots 🌿",
    "you keep going outside — nice",
    "nature person 👀",
    "you've been into outdoor stuff lately",
  ],
  study:    [
    "you've been looking at study spots 📚",
    "you really like a good study spot",
    "hardworking 👀",
    "you've been studying a lot lately",
  ],
  shopping: [
    "you really like shopping 🛍️",
    "you've been into shopping lately",
    "treat yourself huh",
    "you keep finding things to buy 👀",
  ],
  campus:   [
    "you're very into campus stuff 🎓",
    "you've been exploring campus",
    "campus explorer 👀",
    "you really like campus things",
  ],
}

function behaviorMemoryMsg(bond: number): string | null {
  if (bond < 3) return null
  try {
    const signal = loadCatSignal()
    if (signal.length < 3) return null
    const freq: Record<string, number> = {}
    for (const cat of signal) freq[cat] = (freq[cat] ?? 0) + 1
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
    if (!top || top[1] < 2) return null
    const pool = CAT_MEMORY_MSGS[top[0]]
    if (!pool) return null
    return pick(pool)
  } catch { return null }
}

// ── Dialogue pools ────────────────────────────────────────────────────────────

type ActionType = 'save' | 'share' | 'calendar'

const TEASE = ["this is… interesting 😭", "you sure about this one?", "bold choice"] as const

/**
 * Occasionally sprinkles the user's first name into a message.
 * Only fires when: name is known + bond >= 5 + 18% random chance.
 * Keeps dialogue personal without being robotic.
 */
function maybePersonalize(msg: string, userName: string | null, bond: number): string {
  if (!userName || bond < 5) return msg
  if (Math.random() > 0.18) return msg
  return `${msg}, ${userName}`
}

/**
 * Bond-aware, personality-flavored message for save/share/calendar actions.
 * Bond >= 20 unlocks the most expressive tier; then >= 15, >= 6, and low.
 */
function bondMsg(action: ActionType, bond: number, petType: string): string {
  const p = petType as PetType

  if (action === 'save') {
    // ── NEW: super-expressive tier ──
    if (bond >= 20) {
      return pick(["you always find the good stuff 🐾", "I like your taste ❤️", "we're just built different"])
    }
    if (bond >= 15) {
      if (p === 'cat')    return pick(["fine, this is good", "...yes this one", "I suppose I agree"])
      if (p === 'fox')    return pick(["clean pick 😉", "smart move", "we got what we needed"])
      if (p === 'bunny')  return pick(["caught you having good taste 👀", "hold it — this is actually good"])
      if (p === 'tiger')  return pick(["strong pick 🐯", "that's the one"])
      if (p === 'monkey') return pick(["YESSS 🙈", "that's the ONE!!!"])
      if (p === 'panda')  return pick(["...this one is nice", "good choice, quietly"])
      return pick(["we have such good taste ❤️", "I knew you'd like this", "yes, this one"])
    }
    if (bond >= 6) {
      if (p === 'cat')   return pick(["not bad", "okay fine, solid pick"])
      if (p === 'fox')   return pick(["efficient choice", "noted and approved 😉"])
      if (p === 'bunny') return pick(["caught you picking well 👀", "not bad at all"])
      return pick(["nice one, I like this too ❤️", "solid pick"])
    }
    if (Math.random() < 0.2) return pick(TEASE)
    if (p === 'cat') return "saved."
    if (p === 'fox') return pick(["logged.", "filed 😉"])
    return pick(["good find.", "noted.", "saved."])
  }

  if (action === 'share') {
    if (bond >= 20) return pick(["you always share the good stuff 🐾", "spreading the good taste ❤️"])
    if (bond >= 15) return pick(["spreading the love 🎉", "you always find the good stuff 👀", "yes, share it"])
    if (bond >= 6)  return pick(["ooh, spreading the word 👀", "love that"])
    return pick(["shared.", "okay."])
  }

  if (action === 'calendar') {
    if (bond >= 20) return pick(["planning ahead — I respect it 🗓️", "you're not gonna miss this one 🐾"])
    if (bond >= 15) return pick(["I'll be thinking about it too 🗓️", "don't miss it this time 😏"])
    if (bond >= 6)  return pick(["good call — don't miss it 🗓️", "don't miss it 😏"])
    return "added."
  }

  return ""
}

function trendingMsg(bond: number): string {
  if (bond >= 6) return pick(["this one's popular… 👀", "hmm everyone's going 👀", "I can see why this is trending"])
  return pick(["this one's popular…", "hmm everyone's going 👀"])
}

// ── NEW: Mood-aware line ─────────────────────────────────────────────────────
/**
 * Generates a mood-flavored ambient line.
 * Mapped from pet server mood: excited → happy/active, idle → bored/quiet.
 * Returns null for 'happy' (neutral — no mood comment needed).
 */
function moodLine(mood: PetMood): string | null {
  if (mood === 'excited') {
    return pick(["this is fun 🐾", "I like this", "good energy today"])
  }
  if (mood === 'idle') {
    return pick(["we haven't done much lately…", "kinda quiet here", "where have you been"])
  }
  return null  // happy = neutral, no comment
}

// ── NEW: Time-aware greeting ─────────────────────────────────────────────────
/**
 * Returns a time-of-day greeting or null if mid-day (nothing to say).
 * Only fires at low frequency — callers should gate on ~25-30% random.
 */
function timeGreeting(): string | null {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 10)              return pick(["morning 👀", "early start?", "up early 👀"])
  if (hour >= 18 && hour < 21)             return pick(["something tonight?", "feels like a good night for this", "evening plans 👀"])
  if (hour >= 21 || hour < 4)              return pick(["you're still up?", "late night scrolling huh", "it's late… 👀"])
  return null
}

// ── NEW: Return detection message ────────────────────────────────────────────
/**
 * Returns a contextual return message based on time gap since last visit.
 * Returns null if gap < 1h (no comment warranted).
 */
function returnMsg(gapMs: number): string | null {
  const hours = gapMs / 3_600_000
  if (hours < 1)  return null
  if (hours < 8)  return pick(["back again 🙂", "you came back"])
  if (hours < 36) return pick(["haven't seen you in a bit 🙂", "you were away for a while"])
  if (hours < 72) return pick(["it's been a day or two…", "haven't seen you since yesterday"])
  return pick(["it's been a while…", "I kept something for you 🐾", "missed you… a little 🐾"])
}

function idleMsg(bond: number): string {
  if (Math.random() < 0.4) {
    const mem = behaviorMemoryMsg(bond)
    if (mem) return mem
  }
  return bond >= 15 ? "you've been busy… I noticed 🐾" : "still there…?"
}

function sessionMsg(bond: number, petName: string | null): string {
  if (petName && bond >= 10) return `hey, it's me — ${petName} 🐾`
  return bond >= 15 ? "back again — I missed you 🐾" : "I'll keep you company here"
}

// ── NEW: Pet-initiates pool ──────────────────────────────────────────────────
/** Pet speaks without user action — fires once per session, low probability. */
const PET_INITIATES = [
  "this one looks interesting",
  "you might like this",
  "hmm… what should we check",
  "something good is out there",
  "I found something for you",
] as const

// ── Guest dialogue ────────────────────────────────────────────────────────────

/** Session-opener for guests, tuned to accumulated guest bond + action count. */
function guestSessionMsg(guestBond: number, guestActions: number): string {
  if (guestBond >= 8 || guestActions >= 8)
    return pick(["you found me again 🙂", "I remember you", "good to see you 🐾"])
  if (guestBond >= 4 || guestActions >= 4)
    return pick(["back again 🙂", "hey, you came back", "you're here again"])
  return pick(["I'll keep you company here", "hi 👀", "find something good today"])
}

/** Return greeting for guests who revisit after being away. */
function guestReturnMsg(gapMs: number, guestBond: number): string | null {
  const hours = gapMs / 3_600_000
  if (hours < 1 || guestBond < 2) return null
  if (hours < 8)  return pick(["you came back 🙂", "back again"])
  if (hours < 36) return pick(["haven't seen you in a bit", "you were gone for a while"])
  return pick(["you came back 🐾", "I kept your spot here"])
}

/** Ambient idle line for guest users, based on history. Priority: taps → saves → inactivity. */
function guestIdleMsg(guestBond: number, guestActions: number, gapSinceActionMs: number): string {
  const hoursSince = gapSinceActionMs / 3_600_000
  const taps = loadGuestTaps()
  if (taps >= 5)                         return pick(["you found me again 🙂", "you keep coming back"])
  if (guestActions >= 3)                 return pick(["you've been finding good stuff", "nice picks lately 🐾"])
  if (hoursSince > 24 && guestBond > 0) return pick(["been quiet here…", "still there?"])
  return pick(["find anything good?", "still there…?"])
}

// ── Per-pet avatar tap pools ──────────────────────────────────────────────────

const AVATAR_TAP: Record<PetType, {
  single: readonly string[]
  rapid:  readonly string[]
  bonded: readonly string[]
}> = {
  dog:    {
    single: ["hey!! 🐶", "hiiii", "pet me?"],
    rapid:  ["okay okay okay!!! 🐶", "MORE!!!"],
    bonded: ["youre my favorite ever 🐾❤️"],
  },
  cat:    {
    single: ["...hi", "what do you want", "hm."],
    rapid:  ["please stop 😐", "I tolerate you"],
    bonded: ["fine. I like you a little 😭❤️"],
  },
  bird:   {
    single: ["tweet! 🐦", "hi hi hi!", "chirp"],
    rapid:  ["tweet tweet tweet 😭", "flap flap!"],
    bonded: ["you're my nest 🐦❤️"],
  },
  fox:    {
    single: ["sharp instincts 👀", "you found me", "heh."],
    rapid:  ["calculated. 😤", "alright, you win"],
    bonded: ["you're growing on me 😭❤️"],
  },
  bunny:  {
    single: ["hold it 👀", "caught you", "hey."],
    rapid:  ["stop right there 😤", "you're in trouble"],
    bonded: ["you're annoying 😭❤️"],
  },
  frog:   {
    single: ["ribbit 👀", "boop", "you poked me"],
    rapid:  ["ribbit ribbit ribbit 😭", "okay okay!"],
    bonded: ["you're my favorite human 😭❤️"],
  },
  panda:  {
    single: ["...oh, hi", "hello there 🐼", "mmm?"],
    rapid:  ["okay… I see you", "still here?"],
    bonded: ["I like you too 🐾❤️"],
  },
  monkey: {
    single: ["heyyy 🙈", "hehe gotcha", "tickle!"],
    rapid:  ["HAHAHA okay okay 🙈", "you're so silly"],
    bonded: ["you're my fave 🙈❤️"],
  },
  tiger:  {
    single: ["bold move 🐯", "you dare?", "interesting."],
    rapid:  ["persistent, I see 😤", "alright then."],
    bonded: ["respect earned 🐯❤️"],
  },
}

const TAP_SINGLE = ["hey 👀", "you found me", "hi again", "hmm?"]        as const
const TAP_RAPID  = ["okay okay I'm here 😭", "you like tapping huh", "alright, alright!"] as const
const TAP_BONDED = ["you again 🙂", "I like hanging out here with you", "always happy to see you 🐾"] as const

// ── Animation types ───────────────────────────────────────────────────────────

type ReactionType = 'bounce' | 'excited' | 'celebrate'
type ReactionDetail = {
  type:     ReactionType
  message?: string
  action?:  ActionType
  context?: 'trending'
  bond?:    number
}

const MOOD_BG: Record<PetMood, string> = {
  idle:    '#F3F4F6',
  happy:   '#FEF9C3',
  excited: '#FEF3C7',
}

const REACTION_CLASS: Record<ReactionType, string> = {
  bounce:    'pet-react-bounce',
  excited:   'pet-react-excited',
  celebrate: 'pet-react-celebrate',
}

const MOOD_ANIM_CLASS: Record<PetMood, string> = {
  idle:    'pet-anim-idle',
  happy:   'pet-anim-happy',
  excited: 'pet-anim-excited',
}

const REACTION_DURATION: Record<ReactionType, number> = {
  bounce: 600, excited: 700, celebrate: 1200,
}

const COOLDOWN_MS = 18_000

// ── XP bar ────────────────────────────────────────────────────────────────────

function XpBar({ xp }: { xp: number }) {
  const prog  = levelProgress(xp)
  const level = computeLevel(xp)

  if (prog.maxed) {
    return <p className="text-[11px] font-semibold text-amber-500 text-center">Max level reached 🏆</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#9CA3AF]">{prog.current} / {prog.needed} XP</span>
        <span className="text-[10px] font-medium text-[#6B7280]">→ Lv.{level + 1}</span>
      </div>
      <div className="h-[6px] rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-500"
          style={{ width: `${Math.max(2, prog.pct)}%` }}
        />
      </div>
    </div>
  )
}

// ── Pet chooser ───────────────────────────────────────────────────────────────

function PetChooser({
  current, unlocked, points, onChoose, onUnlock,
}: {
  current:  string
  unlocked: string[]
  points:   number
  onChoose: (t: string) => void
  onUnlock: (t: string) => void
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2.5">Your pets</p>
      <div className="flex flex-wrap gap-1 justify-center">
        {PET_TYPES.map((type) => {
          const price      = PET_PRICES[type as PetType]
          const isUnlocked = unlocked.includes(type) || price === 0
          const isActive   = current === type
          const canAfford  = points >= price

          return (
            <div key={type} className="flex flex-col items-center gap-0.5">
              <button
                onClick={() => isUnlocked ? onChoose(type) : onUnlock(type)}
                disabled={!isUnlocked && !canAfford}
                title={isUnlocked ? PET_LABEL[type as PetType] : `${price} pts to unlock`}
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-[18px] transition-all ${
                  isActive
                    ? 'bg-amber-50 border-2 border-amber-400 scale-110'
                    : isUnlocked
                    ? 'bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] hover:scale-105'
                    : canAfford
                    ? 'bg-[#F9FAFB] border border-dashed border-amber-300 opacity-70 hover:opacity-90 hover:bg-amber-50 cursor-pointer'
                    : 'bg-[#F9FAFB] border border-[#E5E7EB] opacity-35 grayscale cursor-not-allowed'
                }`}
              >
                {PET_EMOJI[type as PetType]}
              </button>
              {!isUnlocked && price > 0 && (
                <span className={`text-[8px] font-semibold tabular-nums ${canAfford ? 'text-amber-500' : 'text-[#C4C9D4]'}`}>
                  {price}pt
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Animated avatar ───────────────────────────────────────────────────────────

function PetAvatar({
  emoji, mood, reaction, size = 'sm', onTap,
}: {
  emoji:    string
  mood:     PetMood
  reaction: ReactionType | null
  size?:    'sm' | 'lg'
  onTap?:   () => void
}) {
  const dim  = size === 'lg' ? 'w-[60px] h-[60px] text-[38px]' : 'w-[36px] h-[36px] text-[22px]'
  const anim = reaction ? REACTION_CLASS[reaction] : MOOD_ANIM_CLASS[mood]

  const inner = (
    <div
      className={`${dim} rounded-full flex items-center justify-center select-none transition-colors duration-500`}
      style={{
        backgroundColor: MOOD_BG[mood],
        boxShadow: mood === 'excited'
          ? '0 0 12px 4px rgba(251,191,36,0.35)'
          : mood === 'happy'
          ? '0 0 8px 2px rgba(251,191,36,0.2)'
          : 'none',
      }}
    >
      <span className={`leading-none ${anim}`} style={{ display: 'inline-block' }}>{emoji}</span>
    </div>
  )

  if (!onTap) return inner

  return (
    <button
      onClick={onTap}
      aria-label="Tap your pet"
      className="cursor-pointer focus:outline-none active:scale-95 transition-transform"
    >
      {inner}
    </button>
  )
}

// ── Sparkles ──────────────────────────────────────────────────────────────────

function Sparkles() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {(['✨', '⭐', '✨', '⭐'] as const).map((s, i) => (
        <span key={i} className="pet-sparkle absolute text-[14px] leading-none"
          style={{ top: `${20 + (i % 2) * 30}%`, left: i < 2 ? `${10 + i * 8}%` : `${72 + (i - 2) * 10}%` }}
        >{s}</span>
      ))}
    </div>
  )
}

// ── Speech bubble ─────────────────────────────────────────────────────────────

function SpeechBubble({ message, fading }: { message: string; fading: boolean }) {
  return (
    <div
      className={`relative max-w-[280px] md:max-w-[380px] self-end ${fading ? 'pet-speech-out' : 'pet-speech-in'}`}
      aria-live="polite"
    >
      <div className="bg-white border border-[#E5E7EB] rounded-2xl rounded-br-sm px-3.5 py-2.5 shadow-lg">
        <p className="text-[13px] text-[#374151] leading-relaxed whitespace-normal">{message}</p>
      </div>
      <div
        className="absolute -bottom-[5px] right-7 w-2.5 h-2.5 bg-white border-r border-b border-[#E5E7EB] rotate-45"
        aria-hidden
      />
    </div>
  )
}

// ── Recommendation ────────────────────────────────────────────────────────────

const LABEL_MATCHED  = [
  "this feels like your kind of thing",
  "thought of you when I saw this",
  "I think you'll like this one",
] as const
const LABEL_FALLBACK = ["you might like this"] as const
const TEASE_LINES    = [
  "hmm… this is new for you 😭",
  "not your usual vibe… interesting 👀",
] as const

// RecItem includes start_time + tags for chip filtering
interface RecItem { id: string; title: string; category: string; start_time?: string | null; tags?: string[] }

const REC_SESSION_KEY = 'nearu-pet-rec-3'
const REC_POOL_KEY    = 'nearu-pet-pool'
interface RecCache { items: RecItem[]; label: string }

// ── Quick refine chips ────────────────────────────────────────────────────────

const REFINE_CHIPS = [
  { key: 'tonight', label: '🌙 tonight' },
  { key: 'food',    label: '🍜 food'    },
  { key: 'outdoor', label: '🌿 outdoor' },
  { key: 'chill',   label: '😌 chill'   },
] as const
type ChipKey = typeof REFINE_CHIPS[number]['key']

const CHIP_LABELS: Record<ChipKey, string> = {
  tonight: 'happening tonight',
  food:    'food spots',
  outdoor: 'outdoor picks',
  chill:   'chill picks',
}
const CHIP_MSGS: Record<ChipKey, string> = {
  tonight: "here's what's on tonight 🌙",
  food:    "finding food spots for you 🍜",
  outdoor: "outdoor spots you might like 🌿",
  chill:   "chill picks — take it easy 😌",
}

// ── Feedback clarity copy (PARTS 1 + 2) ──────────────────────────────────────

/** Brief flash messages — appear for 2 s then vanish */
const CHIP_FLASH: Record<ChipKey, string> = {
  tonight: 'Filtering to tonight 🌙',
  food:    'Filtering to food 🍜',
  outdoor: 'Filtering to outdoor 🌿',
  chill:   'Filtering to chill picks 😌',
}
/** Persistent "why it changed" lines shown under the primary card */
const CHIP_ADJUST: Record<ChipKey, string> = {
  tonight: 'Events in the next 24 hours',
  food:    'Narrowed to food spots',
  outdoor: 'Narrowed to outdoor spots',
  chill:   'Quieter, lower-key picks',
}
/** Readable short name per category for "More X picks" adjust line */
const CAT_ADJUST: Record<string, string> = {
  food:     'food spots',
  events:   'events',
  outdoor:  'outdoor picks',
  study:    'study spots',
  shopping: 'shopping',
  campus:   'campus things',
}

/** PART 3 — Learning status line; only surfaced after meaningful interaction */
function learningStatus(n: number): string | null {
  if (n < 2) return null
  if (n < 5) return 'learning what you like'
  return 'getting more specific for you'
}

function matchesChip(item: RecItem, chip: ChipKey): boolean {
  if (chip === 'food')    return item.category === 'food'
  if (chip === 'outdoor') return item.category === 'outdoor'
  if (chip === 'tonight') {
    if (!item.start_time) return false
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    return h > 0 && h < 24
  }
  if (chip === 'chill') {
    const tags = item.tags ?? []
    return ['outdoor', 'study'].includes(item.category) ||
      tags.some(t => ['quiet', 'study-spot', 'coffee', 'cafe'].includes(t))
  }
  return true
}

/** Score + sort pool client-side; falls back to unfiltered if chip yields nothing. */
function scorePool(
  pool:     RecItem[],
  signal:   string[],
  excluded: Set<string>,
  chip:     ChipKey | null,
  limit:    number,
): RecItem[] {
  let candidates = pool.filter(i => !excluded.has(i.id))
  if (chip) {
    const filtered = candidates.filter(i => matchesChip(i, chip))
    if (filtered.length > 0) candidates = filtered
  }
  return candidates
    .map(i => ({ item: i, score: signal.filter(c => c === i.category).length, rand: Math.random() }))
    .sort((a, b) => b.score - a.score || b.rand - a.rand)
    .slice(0, limit)
    .map(s => s.item)
}

function PetRecommendation({
  onClose,
  isGuest,
  onSay,
  onInteracted,
}: {
  onClose:       () => void
  isGuest?:      boolean
  onSay?:        (msg: string) => void
  onInteracted?: () => void
}) {
  const limit = isGuest ? 2 : 3

  const [pool, setPool]             = useState<RecItem[]>([])
  const [items, setItems]           = useState<RecItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [label, setLabel]           = useState('you might like these')
  const [activeChip, setActiveChip] = useState<ChipKey | null>(null)
  const [excluded, setExcluded]     = useState<Set<string>>(new Set())
  const signalRef                   = useRef<string[]>([])

  // ── PART 1 — "Updated for you" flash ─────────────────────────────────────
  const [feedbackMsg, setFeedbackMsg]   = useState<string | null>(null)
  const feedbackTimerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── PART 2 — Persistent "why it changed" label ───────────────────────────
  const [adjustMsg, setAdjustMsg]       = useState<string | null>(null)

  // ── PART 4 — Primary card animation trigger ───────────────────────────────
  // Incrementing this value changes the React key on the primary card wrapper,
  // causing React to remount it and replay the animate-fade-up CSS animation.
  const [recRevision, setRecRevision]   = useState(0)

  // ── PART 3 — Learning indicator ───────────────────────────────────────────
  // Lazy-init from cross-session engagement so returning users see it sooner.
  const [engagementCount, setEngagementCount] = useState(() => {
    try {
      const e = loadEngagement()
      return (e.moreLikeThis ?? 0) + (e.chipClicks ?? 0) + (e.modalOpens ?? 0)
    } catch { return 0 }
  })

  // Cleanup feedback timer on unmount
  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    const signal = loadCatSignal()
    signalRef.current = signal

    // Fast path: show cached top-N immediately
    try {
      const cached = sessionStorage.getItem(REC_SESSION_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as RecCache
        if (parsed?.items?.length > 0) {
          setItems(parsed.items.slice(0, limit))
          setLabel(parsed.label ?? 'you might like these')
        }
      }
    } catch {}

    // Pool cache: enables client-side rescoring without re-fetch
    try {
      const poolRaw = sessionStorage.getItem(REC_POOL_KEY)
      if (poolRaw) {
        const parsed = JSON.parse(poolRaw) as RecItem[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPool(parsed)
          setLoading(false)
          return
        }
      }
    } catch {}

    // Fresh fetch — stores full pool for rescoring
    const savedIds = loadSavedIds()
    fetch('/api/items?limit=60&sort=recent')
      .then(r => r.ok ? r.json() : [])
      .then((all: RecItem[]) => {
        if (!Array.isArray(all) || all.length === 0) return
        const candidates = all.filter(i => !savedIds.has(i.id))
        if (candidates.length === 0) return

        setPool(candidates)
        try { sessionStorage.setItem(REC_POOL_KEY, JSON.stringify(candidates)) } catch {}

        const scored   = scorePool(candidates, signal, new Set(), null, limit)
        const hasMatch = scored.some(i => signal.includes(i.category))
        const resolved = hasMatch ? pick([...LABEL_MATCHED]) : pick([...LABEL_FALLBACK])
        setItems(scored)
        setLabel(resolved)
        try { sessionStorage.setItem(REC_SESSION_KEY, JSON.stringify({ items: scored.slice(0, 3), label: resolved } as RecCache)) } catch {}
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Show a brief "Updated for you" flash + optionally update the persistent adjust reason */
  function flash(msg: string, reason?: string) {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedbackMsg(msg)
    if (reason !== undefined) setAdjustMsg(reason)
    feedbackTimerRef.current = setTimeout(() => setFeedbackMsg(null), 2000)
  }

  /** PART 5 — Reset session-level steering (chips + exclusions).
   *  Does NOT wipe the long-term category signal in localStorage. */
  function handleReset() {
    setActiveChip(null)
    setExcluded(new Set())
    setAdjustMsg(null)
    // Re-read signal fresh (any thumbs-up boosts from this session stay — they're intentional)
    const freshSignal = loadCatSignal()
    signalRef.current = freshSignal
    setItems(scorePool(pool, freshSignal, new Set(), null, limit))
    setLabel('you might like these')
    setRecRevision(r => r + 1)
    flash('Suggestions reset')
    onSay?.('starting fresh — here are my default picks 🐾')
  }

  function handleChip(chip: ChipKey) {
    bumpEngagement('chipClicks')
    onInteracted?.()
    setEngagementCount(c => c + 1)
    if (activeChip === chip) {
      // Toggle off
      setActiveChip(null)
      setItems(scorePool(pool, signalRef.current, excluded, null, limit))
      setLabel('you might like these')
      setAdjustMsg(null)
      setRecRevision(r => r + 1)
      flash('Back to all picks')
      onSay?.('okay, back to my picks 🐾')
    } else {
      setActiveChip(chip)
      setItems(scorePool(pool, signalRef.current, excluded, chip, limit))
      setLabel(CHIP_LABELS[chip])
      setRecRevision(r => r + 1)
      flash(CHIP_FLASH[chip], CHIP_ADJUST[chip])
      onSay?.(CHIP_MSGS[chip])
    }
  }

  function handleThumbsUp() {
    if (items.length === 0) return
    const primary = items[0]
    // Boost category in signal (push twice for extra weight, cap at 10)
    try {
      const raw     = localStorage.getItem(CAT_SIGNAL_KEY)
      const current = raw ? (JSON.parse(raw) as string[]) : []
      const updated = [primary.category, primary.category, ...current].slice(0, 10)
      localStorage.setItem(CAT_SIGNAL_KEY, JSON.stringify(updated))
      signalRef.current = updated
    } catch {}
    bumpEngagement('moreLikeThis')
    onInteracted?.()
    setEngagementCount(c => c + 1)
    setItems(scorePool(pool, signalRef.current, excluded, activeChip, limit))
    setLabel('more like this ↑')
    setRecRevision(r => r + 1)
    const catLabel = CAT_ADJUST[primary.category] ?? primary.category
    flash('Updated for you 🐾', `More ${catLabel}`)
    onSay?.('got it, more like this 🐾')
  }

  function handleThumbsDown() {
    if (items.length === 0) return
    const newExcl = new Set(excluded)
    newExcl.add(items[0].id)
    setExcluded(newExcl)
    setItems(scorePool(pool, signalRef.current, newExcl, activeChip, limit))
    onInteracted?.()
    setEngagementCount(c => c + 1)
    setRecRevision(r => r + 1)
    flash('Got it — swapping this out', 'Skipping that one')
    onSay?.("okay, let's try something different")
  }

  if (loading) return (
    <div className="px-4 pb-3">
      <p className="text-[10px] font-semibold text-[#C4C9D4] uppercase tracking-wider mb-2">you might like these</p>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: limit }).map((_, i) => <div key={i} className="h-9 rounded-xl skeleton" />)}
      </div>
    </div>
  )

  if (items.length === 0) {
    return (
      <div className="px-4 pb-3 text-center">
        <p className="text-[11px] text-[#9CA3AF] mb-2">I'm looking for something good for you 🐾</p>
        <Link
          href="/search?sort=recent"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:text-amber-700 transition-colors"
        >
          Explore recent additions →
        </Link>
      </div>
    )
  }

  const [primary, ...secondary] = items
  const primaryIcon = CATEGORIES.find(c => c.slug === primary.category)?.icon ?? '📌'
  const status      = learningStatus(engagementCount)
  const hasFilters  = activeChip !== null || excluded.size > 0

  return (
    <div className="px-4 pb-3">

      {/* PART 1 — "Updated for you" flash: mounts with animate-fade-up, auto-dismissed after 2 s */}
      {feedbackMsg && (
        <p className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1.5 mb-2 animate-fade-up">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden />
          {feedbackMsg}
        </p>
      )}

      {/* Quick refine chips */}
      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {REFINE_CHIPS.map(chip => (
          <button
            key={chip.key}
            onClick={() => handleChip(chip.key)}
            className={`text-[11px] font-medium rounded-full px-2.5 py-1 transition-all whitespace-nowrap ${
              activeChip === chip.key
                ? 'bg-amber-500 text-white border border-amber-500'
                : 'bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB] hover:border-amber-300 hover:text-amber-700'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* PART 3 — Learning indicator: only after real interaction */}
      {status && (
        <p className="text-[9px] text-amber-400/80 flex items-center gap-1 mb-1.5">
          <span className="w-1 h-1 rounded-full bg-amber-300 animate-pulse shrink-0" aria-hidden />
          {status}
        </p>
      )}

      {/* Label row + PART 5 reset button (only when there's steering to undo) */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">{label}</p>
        {hasFilters && (
          <button
            onClick={handleReset}
            className="text-[9px] text-[#C4C9D4] hover:text-[#9CA3AF] transition-colors"
            title="Reset to default suggestions"
          >
            reset ↺
          </button>
        )}
      </div>

      {/* PART 4 — Primary recommendation.
          key={recRevision} forces React to remount this block on each feedback action,
          replaying animate-fade-up so the user sees the card visibly swap. */}
      <div key={recRevision} className="animate-fade-up">
        <Link
          href={`/listing/${primary.id}`}
          onClick={onClose}
          className="flex items-center gap-2 bg-amber-50 hover:bg-amber-100 border border-amber-100 hover:border-amber-200 rounded-xl px-2.5 py-2.5 transition-all group mb-1"
        >
          <span className="text-[15px] leading-none shrink-0">{primaryIcon}</span>
          <span className="text-[12px] font-semibold text-[#92400E] group-hover:text-[#7C2D12] transition-colors line-clamp-1 flex-1 min-w-0">{primary.title}</span>
          <span className="text-[10px] text-amber-400 group-hover:text-amber-600 transition-colors shrink-0">→</span>
        </Link>
        {/* PART 2 — "Why it changed" explanation */}
        {adjustMsg && (
          <p className="text-[9px] text-[#9CA3AF] mb-1.5 pl-1">{adjustMsg}</p>
        )}
      </div>

      {/* Feedback row — 👍/👎 */}
      {pool.length > 0 && (
        <div className="flex items-center gap-3 mb-2.5 pl-0.5">
          <button
            onClick={handleThumbsUp}
            className="flex items-center gap-1 text-[10px] font-medium text-[#9CA3AF] hover:text-emerald-600 transition-colors"
          >
            <span>👍</span><span>more like this</span>
          </button>
          <span className="text-[#E5E7EB] text-[12px]">·</span>
          <button
            onClick={handleThumbsDown}
            className="flex items-center gap-1 text-[10px] font-medium text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
          >
            <span>👎</span><span>not this</span>
          </button>
        </div>
      )}

      {/* Secondary recommendations */}
      {secondary.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#C4C9D4] uppercase tracking-wider mb-1.5">you might also like</p>
          <div className="flex flex-col gap-1.5">
            {secondary.map(item => {
              const catIcon = CATEGORIES.find(c => c.slug === item.category)?.icon ?? '📌'
              return (
                <Link
                  key={item.id}
                  href={`/listing/${item.id}`}
                  onClick={onClose}
                  className="flex items-center gap-2 bg-[#F9FAFB] hover:bg-[#F3F4F6] border border-[#F3F4F6] hover:border-[#E5E7EB] rounded-xl px-2.5 py-2 transition-all group"
                >
                  <span className="text-[15px] leading-none shrink-0">{catIcon}</span>
                  <span className="text-[12px] font-medium text-[#374151] group-hover:text-[#111111] transition-colors line-clamp-1 flex-1 min-w-0">{item.title}</span>
                  <span className="text-[10px] text-[#C4C9D4] group-hover:text-[#9CA3AF] transition-colors shrink-0">→</span>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Rarity badge ─────────────────────────────────────────────────────────────

function RarityBadge({ rarity, size = 'sm' }: { rarity: PetRarity; size?: 'sm' | 'lg' }) {
  const c = RARITY_COLORS[rarity]
  return (
    <span
      className={`inline-block font-bold rounded-full px-2 py-0.5 ${size === 'lg' ? 'text-[12px]' : 'text-[9px]'}`}
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {RARITY_LABEL[rarity]}
    </span>
  )
}

// ── Hatch reveal card (inside modal during first-time flow) ───────────────────

type HatchPhase = 'egg' | 'hatching' | 'revealed'

function HatchContent({
  phase, drawnPet, onHatch, onDone,
}: {
  phase:    HatchPhase
  drawnPet: PetType | null
  onHatch:  () => void
  onDone:   () => void
}) {
  if (phase === 'egg') {
    return (
      <div className="flex flex-col items-center py-6 px-4 text-center">
        <span className="text-[64px] leading-none mb-4 select-none">🥚</span>
        <p className="text-[17px] font-black text-[#111111] mb-1">Hatch your companion</p>
        <p className="text-[12px] text-[#9CA3AF] mb-5 leading-relaxed">
          Every companion is unique.<br />See who finds you.
        </p>
        <button
          onClick={onHatch}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white text-[14px] font-bold rounded-xl py-3 transition-colors active:scale-95"
        >
          Tap to hatch
        </button>
      </div>
    )
  }

  if (phase === 'hatching') {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="text-[64px] leading-none pet-react-excited select-none" style={{ display: 'inline-block' }}>🥚</span>
        <p className="text-[12px] text-[#9CA3AF] mt-4">hatching…</p>
      </div>
    )
  }

  // revealed
  if (!drawnPet) return null
  const rarity    = PET_RARITY[drawnPet]
  const emoji     = PET_EMOJI[drawnPet]
  const label     = PET_LABEL[drawnPet]
  const isRare    = rarity !== 'common'
  const isSpecial = rarity === 'epic' || rarity === 'legendary'
  const c         = RARITY_COLORS[rarity]

  return (
    <div className="flex flex-col items-center py-6 px-4 text-center">
      {/* Special line fires above the avatar for epic/legendary — short, punchy */}
      {isSpecial && (
        <p className="text-[12px] font-bold mb-2 animate-fade-up" style={{ color: c.text }}>
          {rarity === 'legendary' ? 'you got something special ✨' : 'this one\'s rare… nice 👀'}
        </p>
      )}
      <div
        className={`w-[88px] h-[88px] rounded-full flex items-center justify-center text-[52px] mb-3 ${isSpecial ? 'pet-hatch-special' : ''}`}
        style={{
          backgroundColor: c.bg,
          border: `2px solid ${c.border}`,
          // Rarity-tinted glow for epic/legendary only
          boxShadow: isSpecial ? `0 0 28px 6px ${c.text}40` : '0 4px 12px rgba(0,0,0,0.08)',
        }}
      >
        <span className="pet-react-celebrate select-none" style={{ display: 'inline-block' }}>{emoji}</span>
      </div>
      <RarityBadge rarity={rarity} size="lg" />
      <p className="text-[20px] font-black text-[#111111] mt-2 mb-0.5">{label}</p>
      {isRare && (
        <p className="text-[12px] font-semibold mt-0.5" style={{ color: c.text }}>
          {rarity === 'legendary' ? '✨ Legendary! Incredibly rare!' : rarity === 'epic' ? '🌟 Epic companion!' : '💙 Rare companion!'}
        </p>
      )}
      <p className="text-[11px] text-[#9CA3AF] mt-1 mb-4">
        {rarity === 'legendary' ? 'Only ~2% of companions are this rare.' : rarity === 'epic' ? 'One of the special few.' : isRare ? 'Not everyone gets this.' : 'Your journey starts here.'}
      </p>
      <button
        onClick={onDone}
        className="w-full bg-[#111111] hover:bg-[#333] text-white text-[13px] font-bold rounded-xl py-2.5 transition-colors"
      >
        Meet {label} →
      </button>
    </div>
  )
}

// ── Share-hatch card (celebratory overlay for rare+) ─────────────────────────

function ShareHatchCard({ pet, onDismiss }: { pet: PetType; onDismiss: () => void }) {
  const rarity = PET_RARITY[pet]
  const c      = RARITY_COLORS[rarity]
  const emoji  = PET_EMOJI[pet]
  const label  = PET_LABEL[pet]
  const text   = `I hatched a ${RARITY_LABEL[rarity]} ${label} ${emoji} on NearU! 🎉`

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ text, url: window.location.origin })
      } else {
        await navigator.clipboard.writeText(text)
      }
    } catch { /* user cancelled or API unavailable */ }
  }

  return (
    <div className="absolute inset-0 rounded-2xl flex flex-col z-20 overflow-hidden">
      {/* gradient bg based on rarity */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center" style={{ background: `linear-gradient(135deg, ${c.bg} 0%, #fff 100%)` }}>
        <div className="w-[80px] h-[80px] rounded-full flex items-center justify-center text-[48px] mb-3 shadow-md" style={{ backgroundColor: '#fff', border: `2px solid ${c.border}` }}>
          {emoji}
        </div>
        <RarityBadge rarity={rarity} size="lg" />
        <p className="text-[16px] font-black text-[#111111] mt-2 leading-tight">
          {rarity === 'legendary' ? '✨ Legendary!' : rarity === 'epic' ? '🌟 Epic!' : '💙 Rare!'}
        </p>
        <p className="text-[11px] text-[#6B7280] mt-1 mb-5 leading-relaxed">{text}</p>
        <button
          onClick={handleShare}
          className="w-full text-[13px] font-bold rounded-xl py-2.5 mb-2 transition-colors text-white"
          style={{ backgroundColor: c.text }}
        >
          {typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy'}
        </button>
        <button onClick={onDismiss} className="text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  )
}

// ── Next-pet progress (inside modal — progression cue) ────────────────────────

/** Short personality teaser shown under the progress bar to create desire, not just progress. */
const PET_PERSONALITY_HINT: Partial<Record<PetType, string>> = {
  cat:    "this one has strong opinions 😏",
  fox:    "clever and a little mysterious 👀",
  frog:   "unexpectedly wholesome 🐸",
  panda:  "calm energy, big personality 🐼",
  monkey: "chaotic good 🙈",
  tiger:  "rare pets have stronger personalities 👀",
}

function NextPetProgress({ unlocked, points }: { unlocked: string[]; points: number }) {
  const next = PET_TYPES.find((t) => PET_PRICES[t as PetType] > 0 && !unlocked.includes(t)) as PetType | undefined

  if (!next) {
    return (
      <div className="px-4 py-2 text-center">
        <p className="text-[11px] font-semibold text-emerald-600">All companions unlocked 🏆</p>
      </div>
    )
  }

  const price   = PET_PRICES[next]
  const ptsLeft = Math.max(0, price - points)
  const pct     = Math.min(100, Math.round((points / price) * 100))
  const rarity  = PET_RARITY[next]
  const c       = RARITY_COLORS[rarity]
  const hint    = PET_PERSONALITY_HINT[next]

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[18px] leading-none">{PET_EMOJI[next]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-[#374151] truncate">
            {ptsLeft === 0
              ? `${PET_LABEL[next]} ready to unlock!`
              : `${ptsLeft} pts to ${PET_LABEL[next]}`}
          </p>
          <RarityBadge rarity={rarity} />
        </div>
        <span className="text-[10px] text-[#C4C9D4] shrink-0 tabular-nums">{price} pts</span>
      </div>
      <div className="h-[4px] rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(2, pct)}%`, backgroundColor: c.text }}
        />
      </div>
      {hint && (
        <p className="text-[10px] italic mt-1.5" style={{ color: c.text, opacity: 0.8 }}>{hint}</p>
      )}
    </div>
  )
}

// ── Fallback pet state ────────────────────────────────────────────────────────
// Used when the API fails but the user is (possibly) logged in.
// Keeps the widget visible rather than silently disappearing.

const DEFAULT_PET = {
  pet_type:       'dog',
  xp:             0,
  level:          1,
  mood:           'idle' as PetMood,
  last_action_at: null,
  unlocked_pets:  ['dog'],
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function PetWidget() {
  const { pet, loading, isLoggedOut, refresh, choosePet, unlockPet, hatchEgg } = usePet()
  const { show } = useToast()

  const [open, setOpen]             = useState(false)
  const [mounted, setMounted]       = useState(false)
  const [reaction, setReaction]     = useState<ReactionType | null>(null)
  const [message, setMessage]       = useState<string | null>(null)
  const [fadingOut, setFadingOut]   = useState(false)
  const [bond, setBond]             = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [currentPoints, setCurrentPoints] = useState(0)

  // Pet naming
  const [petName, setPetName]       = useState<string | null>(null)
  const [namingMode, setNamingMode] = useState(false)
  const [nameInput, setNameInput]   = useState('')

  // ── Hatch flow ───────────────────────────────────────────────────────────
  // needsHatch is derived from pet.egg_count — not stored locally
  const [hatchPhase, setHatchPhase] = useState<HatchPhase | null>(null)
  const [drawnPet, setDrawnPet]     = useState<PetType | null>(null)
  const [showShareCard, setShowShareCard] = useState(false)

  // ── Guest bond (localStorage, no auth required) ──────────────────────────
  const [guestBond, setGuestBond]   = useState(0)

  // ── Engagement state — set true when guest uses chips or feedback ─────────
  const [hasInteracted, setHasInteracted] = useState(false)

  // ── Persisted message context (survives speech-bubble dismissal) ──────────
  // Loaded when the modal opens; shows last meaningful reaction in the modal.
  const [lastSavedMsg, setLastSavedMsg]   = useState<PersistedMsg | null>(null)
  const [modalContext, setModalContext]   = useState<{ itemId: string; itemTitle: string | null; itemCategory: string } | null>(null)

  // ── NEW: user name for personalised dialogue ──────────────────────────────
  const [userName, setUserName]     = useState<string | null>(null)

  const widgetRef      = useRef<HTMLDivElement>(null)
  const reactionTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const msgTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMsgAt      = useRef(0)
  const lastTapMsgAt   = useRef(0)
  const idleSaid       = useRef(false)
  const bondRef        = useRef(0)
  const petTypeRef     = useRef<string>('dog')
  const tapTimesRef    = useRef<number[]>([])
  const avatarTapRef   = useRef<number[]>([])
  // Two-tap state machine for the floating button
  const petTapStateRef = useRef<'idle' | 'reacted'>('idle')
  const petTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── NEW: closure-safe refs ────────────────────────────────────────────────
  const userNameRef    = useRef<string | null>(null)  // always-current user name
  const moodRef        = useRef<PetMood>('idle')       // always-current pet mood
  const lastVisitRef   = useRef<number>(0)             // last visit timestamp (read on mount)
  const guestBondRef   = useRef(0)                     // guest bond (no auth)
  const isLoggedOutRef = useRef(false)                 // tracks isLoggedOut for closures

  // ── Mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    setMounted(true)
    const b = loadBond()
    setBond(b)
    bondRef.current = b
    setPetName(loadPetName())

    // NEW: read + update last visit timestamp
    lastVisitRef.current = loadLastVisit()
    updateLastVisit()
  }, [])

  // ── NEW: Keep refs in sync with state ─────────────────────────────────────

  useEffect(() => {
    userNameRef.current = userName
  }, [userName])

  useEffect(() => {
    if (pet?.mood) moodRef.current = pet.mood as PetMood
    if (pet?.pet_type) petTypeRef.current = pet.pet_type
  }, [pet?.mood, pet?.pet_type])

  // Keep isLoggedOutRef current so closures (idle timer, event handler) can read it.
  useEffect(() => { isLoggedOutRef.current = isLoggedOut }, [isLoggedOut])

  // Load guest bond as soon as we know the user is logged out.
  useEffect(() => {
    if (!mounted || !isLoggedOut) return
    const gb = loadGuestBond()
    setGuestBond(gb)
    guestBondRef.current = gb
  }, [mounted, isLoggedOut])

  // No one-time hatch detection needed — hatch is now driven by pet.egg_count from API.

  // ── NEW: Resolve user display name from auth session ─────────────────────
  // Checks user_metadata for a real name (social login / OAuth).
  // Never uses raw email as a name — keeps dialogue genuinely personal.

  useEffect(() => {
    if (!mounted) return
    try {
      const supabase = createBrowserSupabase()
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return
        const meta = session.user.user_metadata ?? {}
        // Prefer social login display name (full_name / name), skip email prefix
        const raw = (meta.full_name ?? meta.name ?? meta.display_name ?? '') as string
        if (!raw || raw.includes('@')) return
        const first = raw.trim().split(/\s+/)[0]
        if (first && first.length >= 2) {
          setUserName(first)
          userNameRef.current = first
        }
      }).catch(() => {})
    } catch {}
  }, [mounted])

  // ── Fetch current points ──────────────────────────────────────────────────

  useEffect(() => {
    if (!mounted) return
    fetch('/api/points')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.current_points != null) setCurrentPoints(d.current_points) })
      .catch(() => {})
  }, [mounted])

  // ── Scroll spring ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mounted) return
    let raf: number
    let rafRunning = false
    let tgt = 0, cur = 0, lastY = window.scrollY

    const onScroll = () => {
      const dy = window.scrollY - lastY
      lastY = window.scrollY
      tgt = Math.max(-8, Math.min(8, dy * 0.3))
      if (!rafRunning) { rafRunning = true; raf = requestAnimationFrame(tick) }
    }
    const tick = () => {
      cur += (tgt - cur) * 0.14; tgt *= 0.88
      const rounded = Math.round(cur * 10) / 10
      setScrollOffset((prev) => Math.abs(prev - rounded) > 0.05 ? rounded : prev)
      if (Math.abs(cur) > 0.05 || Math.abs(tgt) > 0.05) raf = requestAnimationFrame(tick)
      else { rafRunning = false; cur = 0; tgt = 0; setScrollOffset(0) }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [mounted])

  // ── Message helpers ───────────────────────────────────────────────────────
  // Declared before any effect that references them.

  const dismissMsg = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    if (msgTimer.current)  clearTimeout(msgTimer.current)
    setFadingOut(true)
    fadeTimer.current = setTimeout(() => { setMessage(null); setFadingOut(false) }, 200)
  }, [])

  const say = useCallback((msg: string) => {
    if (Date.now() - lastMsgAt.current < COOLDOWN_MS) return
    lastMsgAt.current = Date.now()
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    if (msgTimer.current)  clearTimeout(msgTimer.current)
    setFadingOut(false)
    setMessage(msg)
    msgTimer.current = setTimeout(() => dismissMsg(), 3800)
  }, [dismissMsg])

  const sayForce = useCallback((msg: string) => {
    lastMsgAt.current = 0; say(msg)
  }, [say])

  // ── Pull-back scroll trigger — fires once per session after deep scroll ──────
  // When the user scrolls > 1200 px without interacting, the pet gently prompts
  // them to narrow things down.  One-shot per session via sessionStorage guard.

  useEffect(() => {
    if (!mounted) return
    let fired = false
    function onScroll() {
      if (fired || window.scrollY < 1200) return
      try { if (sessionStorage.getItem('nearu-pet-pullback')) return } catch {}
      fired = true
      try { sessionStorage.setItem('nearu-pet-pullback', '1') } catch {}
      setTimeout(() => sayForce("want me to narrow this down for you? 🐾"), 700)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [mounted, sayForce])

  const sayTap = useCallback((msg: string) => {
    const now = Date.now()
    if (now - lastTapMsgAt.current < 1_500) return
    lastTapMsgAt.current = now
    lastMsgAt.current = now
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    if (msgTimer.current)  clearTimeout(msgTimer.current)
    setFadingOut(false)
    setMessage(msg)
    msgTimer.current = setTimeout(() => dismissMsg(), 3000)
  }, [dismissMsg])

  // ── Greeting / session opener ─────────────────────────────────────────────
  // Runs for both logged-in users (pet != null) and guests (isLoggedOut=true).

  useEffect(() => {
    if (!mounted) return
    // Wait for auth resolution: if still loading and not yet confirmed logged-out, skip.
    if (!pet && !isLoggedOut) return
    try {
      if (!localStorage.getItem(GREETED_KEY)) {
        // ── First-time visit ──────────────────────────────────────────────
        if (isLoggedOut) {
          // Guest first-time: shorter, lighter greeting
          const t1 = setTimeout(() => say("hi 👀 I'm your NearU companion"), 2000)
          const t2 = setTimeout(() => sayForce("find something you like and I'll keep track"), 6000)
          const t3 = setTimeout(() => { try { localStorage.setItem(GREETED_KEY, '1') } catch {} }, 9000)
          return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
        } else {
          // Logged-in first-time greeting (unchanged)
          const name = loadPetName()
          const line1 = name ? `Hey, I'm ${name} 🐾` : "Hey… I'm your NearU companion 🐾"
          const t1 = setTimeout(() => say(line1), 1800)
          const t2 = setTimeout(() => sayForce("Save things you like — I'll remember with you"), 5800)
          const t3 = setTimeout(() => {
            try { localStorage.setItem(GREETED_KEY, '1') } catch {}
            if (!loadPetName() && !isLoggedOut) setNamingMode(true)
          }, 10_500)
          return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
        }
      } else if (!sessionStorage.getItem('nearu-pet-session')) {
        // ── Returning session ─────────────────────────────────────────────
        sessionStorage.setItem('nearu-pet-session', '1')

        if (isLoggedOut) {
          // Guest session opener — bond/action aware
          const gb  = guestBondRef.current
          const ga  = loadGuestActions()
          const gap = Date.now() - lastVisitRef.current
          const ret = guestReturnMsg(gap, gb)
          const opener = ret ?? guestSessionMsg(gb, ga)
          const t = setTimeout(() => say(opener), 4000)
          return () => clearTimeout(t)
        } else {
          // Check whether guest just signed in (migration)
          const migratedBond = loadGuestBond()

          const gap    = Date.now() - lastVisitRef.current
          const retMsg = returnMsg(gap)
          const timMsg = timeGreeting()

          let opener: string
          if (migratedBond > 0) {
            // Just signed in — acknowledge the guest relationship
            opener = "now I can really remember you 🐾"
            clearGuestState()
          } else if (retMsg && gap > 3_600_000) {
            opener = retMsg
          } else if (timMsg && Math.random() < 0.28) {
            opener = timMsg
          } else {
            opener = sessionMsg(bondRef.current, loadPetName())
          }

          const t = setTimeout(() => say(opener), 4000)
          return () => clearTimeout(t)
        }
      }
    } catch { /* storage unavailable */ }
  }, [mounted, pet, isLoggedOut, say, sayForce])

  // ── One-shot idle ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mounted) return
    const t = setTimeout(() => {
      if (!idleSaid.current) {
        idleSaid.current = true
        let msg: string
        if (isLoggedOutRef.current) {
          // Guest-specific idle based on accumulated history
          msg = guestIdleMsg(
            guestBondRef.current,
            loadGuestActions(),
            Date.now() - loadGuestLastAction(),
          )
        } else {
          const ml = moodLine(moodRef.current)
          msg = (ml && Math.random() < 0.38) ? ml : idleMsg(bondRef.current)
        }
        say(msg)
      }
    }, 50_000)
    return () => clearTimeout(t)
  }, [mounted, say])

  // ── NEW: Pet-initiates — speaks once per session, low probability ─────────

  useEffect(() => {
    if (!mounted || !pet) return
    if (Math.random() > 0.22) return                              // 78% skip
    if (sessionStorage.getItem('nearu-pet-initiated')) return     // one-shot per session

    const delay = 28_000 + Math.random() * 12_000                 // 28–40 s
    const t = setTimeout(() => {
      sessionStorage.setItem('nearu-pet-initiated', '1')
      say(pick(PET_INITIATES))
    }, delay)
    return () => clearTimeout(t)
  }, [mounted, pet, say])

  // ── Reaction trigger ──────────────────────────────────────────────────────

  const triggerReaction = useCallback((type: ReactionType) => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current)
    setReaction(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setReaction(type)
      reactionTimer.current = setTimeout(() => {
        setReaction(null); refresh()
      }, REACTION_DURATION[type] + 100)
    }))
  }, [refresh])

  // ── Cross-component event bus ─────────────────────────────────────────────
  // NEW: maybePersonalize applied to action/context messages

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<ReactionDetail>).detail
      if (!detail?.type) return

      triggerReaction(detail.type)

      if (isLoggedOutRef.current) {
        // Guest: bump guest bond on any action event and show a bond-scaled reaction
        if (detail.action) {
          const gb = bumpGuestBond(2)
          bumpGuestActions()
          touchGuestLastAction()
          const ga = loadGuestActions()
          setGuestBond(gb)
          guestBondRef.current = gb

          let msg: string | null = null
          if (detail.action === 'save') {
            if (gb >= 8 || ga >= 6)
              msg = pick(["you've been finding good stuff 🐾", "you have good taste", "I'd check this out too"])
            else if (gb >= 4 || ga >= 3)
              msg = pick(["another good one", "nice find", "solid pick"])
            else
              msg = pick(["good find.", "noted.", "saved."])
          } else if (detail.action === 'share') {
            msg = gb >= 6
              ? pick(["sharing the good stuff 🐾", "spreading the word 👀"])
              : pick(["shared.", "spreading the word 👀"])
          } else if (detail.action === 'calendar') {
            msg = gb >= 6
              ? pick(["don't miss this one 🗓️", "you're actually going? nice"])
              : pick(["added.", "don't miss it 🗓️"])
          } else if (detail.message) {
            msg = detail.message
          }
          if (msg) {
            say(msg)
            // Persist this action message so modal + assistant bar stay in sync
            const ctx = loadPetContext()
            saveLastMsg({ text: msg, ts: Date.now(), itemId: ctx?.itemId ?? null, itemTitle: ctx?.itemTitle ?? null, itemCategory: ctx?.itemCategory ?? null })
            appendToChatHistory(msg, ctx ? [{ id: ctx.itemId, title: ctx.itemTitle ?? '', category: ctx.itemCategory }] : [])
            window.dispatchEvent(new CustomEvent('pet:message', { detail: { text: msg } }))
          }
          return
        }
        // Non-action guest event (e.g. trending context)
        if (detail.message) { say(detail.message); return }
        return
      }

      // Logged-in path (existing)
      let msg: string | null = null
      if (detail.context === 'trending')  msg = trendingMsg(bondRef.current)
      else if (detail.action)             msg = bondMsg(detail.action, bondRef.current, petTypeRef.current)
      else if (detail.message)            msg = detail.message

      if (msg) {
        const finalMsg = maybePersonalize(msg, userNameRef.current, bondRef.current)
        say(finalMsg)
        // Persist action-triggered messages only (not trending/ambient)
        if (detail.action) {
          const ctx = loadPetContext()
          saveLastMsg({ text: finalMsg, ts: Date.now(), itemId: ctx?.itemId ?? null, itemTitle: ctx?.itemTitle ?? null, itemCategory: ctx?.itemCategory ?? null })
          appendToChatHistory(finalMsg, ctx ? [{ id: ctx.itemId, title: ctx.itemTitle ?? '', category: ctx.itemCategory }] : [])
          window.dispatchEvent(new CustomEvent('pet:message', { detail: { text: finalMsg } }))
        }
      }

      if (detail.bond) {
        const newBond = bumpBond(detail.bond)
        setBond(newBond)
        bondRef.current = newBond
      }

      if (detail.type === 'celebrate') {
        const activePet = pet ?? DEFAULT_PET
        show(`${PET_EMOJI[activePet.pet_type as PetType] ?? '🐾'} Level up! Your pet is growing!`)
      }
    }

    window.addEventListener('pet:react', handler)
    return () => window.removeEventListener('pet:react', handler)
  }, [triggerReaction, pet, show, say])

  // ── Outside-click closes modal ────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Load persisted message context when modal opens ──────────────────────
  // Shows the last meaningful pet reaction even after the speech bubble fades.
  // Current-page context (from ViewTracker) takes priority over saved context.

  useEffect(() => {
    if (!open) return
    bumpEngagement('modalOpens')
    const persisted = loadLastMsg()
    setLastSavedMsg(persisted)
    const pageCtx = loadPetContext()
    if (pageCtx) {
      setModalContext(pageCtx)
    } else if (persisted?.itemId && persisted?.itemTitle) {
      setModalContext({
        itemId:       persisted.itemId,
        itemTitle:    persisted.itemTitle,
        itemCategory: persisted.itemCategory ?? '',
      })
    } else {
      setModalContext(null)
    }
  }, [open])

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current)
    if (msgTimer.current)      clearTimeout(msgTimer.current)
    if (fadeTimer.current)     clearTimeout(fadeTimer.current)
    if (petTapTimerRef.current) clearTimeout(petTapTimerRef.current)
  }, [])

  // ── Outer button: two-tap state machine ──────────────────────────────────
  // First tap  → speech bubble reaction (no modal)
  // Second tap within 1.5 s → open modal
  // Timer expires without second tap → reset to idle

  function handlePetClick() {
    // Closing the modal always resets the machine
    if (open) {
      setOpen(false)
      petTapStateRef.current = 'idle'
      if (petTapTimerRef.current) { clearTimeout(petTapTimerRef.current); petTapTimerRef.current = null }
      // Dismiss message when modal is closed
      dismissMsg()
      return
    }

    if (petTapStateRef.current === 'reacted') {
      // Second tap within window → open modal
      if (petTapTimerRef.current) { clearTimeout(petTapTimerRef.current); petTapTimerRef.current = null }
      petTapStateRef.current = 'idle'
      // Freeze message so it remains visible inside the modal
      if (msgTimer.current) { clearTimeout(msgTimer.current); msgTimer.current = null }
      if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null }
      setFadingOut(false)
      setOpen(true)
      return
    }

    // First tap → react, start window
    petTapStateRef.current = 'reacted'
    petTapTimerRef.current = setTimeout(() => {
      petTapStateRef.current = 'idle'
      petTapTimerRef.current = null
    }, 1_500)

    if (isLoggedOut) {
      // Guest: bump bond + tap counter, pick bond-aware message
      const gb = bumpGuestBond(1)
      bumpGuestActions()
      bumpGuestTaps()
      touchGuestLastAction()
      setGuestBond(gb)
      guestBondRef.current = gb
      const msg = gb >= 8
        ? pick(["you found me again 🙂", "I remember you", "hey, it's you 🐾"])
        : gb >= 4
        ? pick(["back again 🙂", "hey you", "hi again"])
        : needsHatch
        ? pick(["I wonder what's inside… 🥚", "tap again to find out", "who will I be? 👀"])
        : pick(TAP_SINGLE as unknown as string[])
      sayTap(msg)
      triggerReaction('bounce')
      return
    }

    // Logged-in: bond-aware + hatch-aware message
    const b   = bondRef.current
    const msg = needsHatch
      ? pick(["I wonder what's inside… 🥚", "who will I be? 👀", "tap again to hatch me"])
      : b >= 15 ? pick(TAP_BONDED as unknown as string[])
      : pick(TAP_SINGLE as unknown as string[])
    sayTap(msg)
    triggerReaction('bounce')
  }

  // ── Hatch execution ───────────────────────────────────────────────────────

  async function handleHatch() {
    setHatchPhase('hatching')
    const drawn = drawHatch()
    setDrawnPet(drawn)

    // Short animation pause before reveal
    await new Promise<void>((r) => setTimeout(r, 1_100))

    setHatchPhase('revealed')

    // Hatch via API: decrements egg_count, unlocks + activates pet, logs event
    const result = await hatchEgg(drawn)
    if (!result.ok) {
      // Fallback: choosePet if hatch API fails (e.g. table not yet migrated)
      await choosePet(drawn)
    } else {
      // API updated pet state — refresh to sync egg_count + unlocked_pets
      await refresh()
    }

    triggerReaction('celebrate')
    sayForce(`hey, I'm ${PET_LABEL[drawn]} 🎉`)

    // Show share card for rare / epic / legendary
    if (PET_RARITY[drawn] !== 'common') {
      setTimeout(() => setShowShareCard(true), 900)
    }
  }

  function handleHatchDone() {
    setHatchPhase(null)
    setDrawnPet(null)
  }

  // ── Avatar tap inside modal ───────────────────────────────────────────────

  function handleAvatarTap() {
    const now    = Date.now()
    const recent = avatarTapRef.current.filter((t) => now - t < 4_000)
    recent.push(now)
    avatarTapRef.current = recent
    const pt    = (petTypeRef.current as PetType) in AVATAR_TAP ? petTypeRef.current as PetType : 'dog'
    const pools = AVATAR_TAP[pt]
    const b     = bondRef.current
    let msg: string, animType: ReactionType
    if (recent.length >= 3 && b >= 12) { msg = pick(pools.bonded); animType = 'excited' }
    else if (recent.length >= 3)        { msg = pick(pools.rapid);  animType = 'excited' }
    else                                { msg = pick(pools.single); animType = 'bounce'  }
    sayTap(msg)
    triggerReaction(animType)
  }

  // ── Pet unlock ────────────────────────────────────────────────────────────

  async function handleUnlockPet(type: string) {
    const price = PET_PRICES[type as PetType] ?? 0
    if (currentPoints < price) {
      show(`Need ${price} pts to unlock ${PET_LABEL[type as PetType]}`, 'error')
      return
    }
    const result = await unlockPet(type)
    if (!result.ok) { show(result.error ?? 'Could not unlock pet', 'error'); return }
    const emoji = PET_EMOJI[type as PetType]
    show(`${emoji} ${PET_LABEL[type as PetType]} unlocked!`)
    if (result.current_points != null) setCurrentPoints(result.current_points)
    else setCurrentPoints((p) => Math.max(0, p - price))
    await choosePet(type)
    triggerReaction('celebrate')
    sayForce(`hey, I'm ${PET_LABEL[type as PetType]} 🎉`)
  }

  // ── Pet naming (logged-in) ────────────────────────────────────────────────

  function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed) { setNamingMode(false); return }
    savePetName(trimmed)
    setPetName(trimmed)
    setNamingMode(false)
    sayForce(`hey, I'm ${trimmed} 🐾`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Debug — helps diagnose rendering issues in production
  // eslint-disable-next-line no-console
  console.log('[PetWidget]', { loading, isLoggedOut, pet: pet?.pet_type ?? null })

  // Hard gate: not mounted yet (SSR) — always skip on server
  if (!mounted) return null

  // Use API data if available, fallback to defaults on API error / slow load.
  // isLoggedOut (401) → guest mode: show widget with limited interaction.
  const isGuest      = isLoggedOut
  const effectivePet = pet ?? DEFAULT_PET

  // === BUG 2 FIX: safe pet type =============================================
  // Always validate pet_type against the unlocked list.  If the DB has an
  // inconsistency (pet_type set to a pet that isn't yet in unlocked_pets —
  // e.g. a partial write during unlock/hatch), or during the brief window
  // where refresh() is in-flight with stale data, this guard ensures we
  // never render a locked pet as the active one.  Falls back to the first
  // unlocked pet (normally 'dog').
  const unlockedPets       = effectivePet.unlocked_pets?.length
    ? effectivePet.unlocked_pets
    : ['dog']
  const safePetType        = unlockedPets.includes(effectivePet.pet_type)
    ? effectivePet.pet_type
    : unlockedPets[0]
  // Rewrite effectivePet so every downstream reference uses the safe type
  const safePet            = { ...effectivePet, pet_type: safePetType }
  // =========================================================================

  const emoji         = PET_EMOJI[safePet.pet_type as PetType] ?? '🐾'
  const mood          = safePet.mood as PetMood
  const isCelebrating = reaction === 'celebrate'
  // Derived from API — repeatable whenever user owns eggs
  const eggCount      = pet ? (pet.egg_count ?? 0) : 0
  const needsHatch    = eggCount > 0

  return (
    /*
     * MOBILE FIX: The outer div is ONLY a fixed position anchor — no transform.
     * Applying transform to a position:fixed element breaks fixed positioning on
     * iOS Safari and many Android browsers (the element scrolls with the page or
     * renders off-screen).  The scroll-spring transform is isolated to the inner
     * wrapper so the fixed anchor always stays in the correct viewport position.
     */
    <div
      ref={widgetRef}
      className="fixed right-4 z-50"
      style={{ bottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px))' }}
    >
    {/* Inner wrapper carries the scroll-spring transform only */}
    <div
      className="flex flex-col items-end gap-2"
      style={{
        transform: `translateY(${scrollOffset}px)`,
        willChange: scrollOffset !== 0 ? 'transform' : 'auto',
      }}
    >
      {/* ── Modal ─────────────────────────────────────────────────────── */}
      {open && (
        {/* === BUG 1 FIX: flex-col + max-h lets the header stay fixed while
             the body scrolls. overflow-hidden is kept for rounded-2xl clipping.
             max-h accounts for the fixed bottom anchor (~80px) so the panel
             never exceeds the viewport. -webkit-overflow-scrolling is applied
             on the inner scroll div for iOS momentum scroll. === */}
        <div className="relative w-[260px] max-w-[calc(100vw-2rem)] bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl overflow-hidden pet-card-open flex flex-col max-h-[calc(100dvh-90px)]">

          {/* Share-hatch overlay (rare / epic / legendary) */}
          {showShareCard && drawnPet && (
            <ShareHatchCard pet={drawnPet} onDismiss={() => setShowShareCard(false)} />
          )}

          {/* Hatch flow — replaces all normal modal content when active */}
          {hatchPhase ? (
            <>
              <div className="flex items-center justify-between px-4 pt-4 pb-1">
                <span className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Your companion</span>
                <button onClick={() => setOpen(false)} className="text-[#C4C9D4] hover:text-[#9CA3AF] transition-colors text-[16px] leading-none" aria-label="Close">×</button>
              </div>
              <HatchContent
                phase={hatchPhase}
                drawnPet={drawnPet}
                onHatch={handleHatch}
                onDone={handleHatchDone}
              />
            </>
          ) : (
            /* Normal modal content */
            <>

          {/* Header — shrink-0 keeps it pinned while body scrolls */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                {isGuest ? 'Your Companion' : (petName ?? 'Your Pet')}
              </span>
              {!isGuest && !petName && (
                <button
                  onClick={() => { setNameInput(''); setNamingMode(true) }}
                  className="text-[9px] text-[#C4C9D4] hover:text-amber-400 transition-colors"
                  title="Name your pet"
                >name it</button>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[#C4C9D4] hover:text-[#9CA3AF] transition-colors text-[16px] leading-none"
              aria-label="Close"
            >×</button>
          </div>

          {/* Scrollable body — flex-1 fills remaining height; overflow-y-auto
               enables scroll; overscroll-contain prevents page scroll bleed;
               -webkit-overflow-scrolling:touch gives iOS momentum scroll. */}
          <div className="overflow-y-auto overscroll-contain flex-1" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

          {/* Naming prompt — logged-in only */}
          {!isGuest && namingMode && (
            <div className="px-4 pb-3">
              <p className="text-[10px] text-[#9CA3AF] mb-1.5">Name your companion</p>
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                  maxLength={20}
                  placeholder="e.g. Mochi"
                  className="flex-1 text-[12px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-300 placeholder:text-[#D1D5DB]"
                />
                <button
                  onClick={handleSaveName}
                  className="text-[11px] font-semibold text-white bg-amber-400 hover:bg-amber-500 rounded-lg px-2.5 transition-colors"
                >Save</button>
              </div>
            </div>
          )}

          {/* ── Assistant message block — always visible, clearly "companion speaking" */}
          {!namingMode && (
            <div className="mx-4 mb-3 bg-amber-50 border border-amber-100 rounded-xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0">
                <span className="text-[11px] leading-none">🐾</span>
                <p className="text-[9px] font-semibold text-amber-500 uppercase tracking-wider">Your companion</p>
              </div>
              <p className="text-[12px] text-[#92400E] font-medium leading-snug px-3 pt-1.5 pb-2.5">
                {message ?? lastSavedMsg?.text ?? "I'm here if you want help finding something 🐾"}
              </p>
            </div>
          )}

          {/* ── Context item — listing the pet last reacted to (PART 5: "you're viewing" label) */}
          {!namingMode && modalContext?.itemId && modalContext?.itemTitle && (
            <div className="mx-4 mb-3">
              <p className="text-[9px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">you&apos;re viewing</p>
              <Link
                href={`/listing/${modalContext.itemId}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 bg-[#F9FAFB] hover:bg-[#F3F4F6] border border-[#F3F4F6] hover:border-[#E5E7EB] rounded-xl px-2.5 py-2 transition-all group"
              >
                <span className="text-[15px] leading-none shrink-0">
                  {CATEGORIES.find(c => c.slug === modalContext.itemCategory)?.icon ?? '📌'}
                </span>
                <span className="text-[12px] font-medium text-[#374151] group-hover:text-[#111111] line-clamp-1 flex-1 min-w-0">
                  {modalContext.itemTitle}
                </span>
                <span className="text-[10px] text-[#C4C9D4] group-hover:text-[#9CA3AF] shrink-0">→</span>
              </Link>
            </div>
          )}

          {/* Pet face + status */}
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="relative shrink-0">
              {isCelebrating && <Sparkles />}
              <PetAvatar emoji={emoji} mood={mood} reaction={reaction} size="lg" onTap={handleAvatarTap} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-black text-[#111111] leading-tight">Level {safePet.level}</p>
              <p className="text-[12px] text-[#6B7280] flex items-center gap-1 mt-0.5">
                <span>{MOOD_EMOJI[safePet.mood]}</span>
                <span>{MOOD_LABEL[safePet.mood]}</span>
              </p>
            </div>
          </div>

          {/* Bond + XP — logged-in only */}
          {!isGuest && (
            <div className="px-4 pb-1">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-[#9CA3AF]">Bond</span>
                <span className="text-[12px] font-bold text-rose-400">{bond} ❤️</span>
              </div>
              <XpBar xp={safePet.xp} />
            </div>
          )}

          {/* ── Egg CTA — shown for logged-in users with eggs ──────────── */}
          {!isGuest && needsHatch && (
            <div className="px-4 pb-3">
              <button
                onClick={() => setHatchPhase('egg')}
                className="w-full flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-[13px] font-bold rounded-xl py-2.5 transition-colors"
              >
                <span>🥚</span>
                <span>Hatch Egg</span>
                <span className="text-[11px] font-medium text-amber-500 ml-1">
                  {eggCount} ready
                </span>
              </button>
            </div>
          )}

          {/* Recommendation — shown to everyone; 2 items for guests, 3 for logged-in */}
          <div className="border-t border-[#F3F4F6] mt-1 pt-3">
            <PetRecommendation
              onClose={() => setOpen(false)}
              isGuest={isGuest}
              onSay={sayForce}
              onInteracted={() => setHasInteracted(true)}
            />
          </div>

          {/* Pet chooser — logged-in only */}
          {!isGuest ? (
            <div className="border-t border-[#F3F4F6]">
              {/* Next-pet progression cue */}
              <div className="border-b border-[#F3F4F6]">
                <NextPetProgress unlocked={unlockedPets} points={currentPoints} />
              </div>
              <div className="px-4 py-3">
                <PetChooser
                  current={safePet.pet_type}
                  unlocked={unlockedPets}
                  points={currentPoints}
                  onChoose={choosePet}
                  onUnlock={handleUnlockPet}
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[9px] text-[#C4C9D4]">{currentPoints} pts available</p>
                  {!needsHatch && (
                    <Link href="/rewards" onClick={() => setOpen(false)}
                      className="text-[9px] text-amber-400 hover:text-amber-500 transition-colors">
                      🥚 Buy egg ({EGG_PRICE} pts) →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Guest CTA — soft, non-intrusive sign-in nudge, copy scales with bond */
            <div className="border-t border-[#F3F4F6] px-4 py-3">
              {/* Soft bond display — only shown once any bond has accumulated */}
              {guestBond > 0 && (
                <p className="text-[11px] text-[#9CA3AF] text-center mb-2">
                  Bond: {guestBond} ❤️
                </p>
              )}
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 w-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-[12px] font-semibold rounded-xl py-2.5 transition-colors"
              >
                <span>🐾</span>
                <span>
                  {hasInteracted || guestBond >= 4
                    ? "Sign in so I can keep getting this right for you 🐾"
                    : guestBond >= 2
                    ? 'Sign in and I\'ll remember you'
                    : 'Sign in to save progress'}
                </span>
              </Link>
              <p className="text-[10px] text-[#C4C9D4] text-center mt-1.5">
                {guestBond >= 2
                  ? 'Your progress here won\'t be lost'
                  : 'Earn points, name your companion, unlock new pets'}
              </p>
            </div>
          )}
          </div>{/* end scrollable body */}
            </> /* end normal modal content */
          )}
        </div>
      )}

      {/* ── Speech bubble ────────────────────────────────────────────── */}
      {message && !open && <SpeechBubble message={message} fading={fadingOut} />}

      {/* ── Pet button ───────────────────────────────────────────────── */}
      <div className="relative">
        {isCelebrating && <Sparkles />}
        <button
          onClick={handlePetClick}
          aria-label={open ? 'Close pet' : needsHatch ? 'Hatch your companion' : 'Open pet'}
          className="flex items-center gap-1.5 bg-white border border-[#E5E7EB] rounded-full pl-2 pr-3 py-2 min-h-[44px] shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-150 select-none"
        >
          {needsHatch ? (
            /* Egg state — pulsing amber glow to invite interaction */
            <div className="w-[36px] h-[36px] rounded-full flex items-center justify-center bg-amber-50 pet-anim-idle">
              <span className="text-[22px] leading-none">🥚</span>
            </div>
          ) : (
            <PetAvatar emoji={emoji} mood={mood} reaction={reaction} size="sm" />
          )}
          <span className="text-[11px] font-bold text-[#374151] leading-none">
            {needsHatch ? '?' : `Lv.${safePet.level}`}
          </span>
        </button>
      </div>
    </div>{/* end scroll-spring wrapper */}
    </div>
  )
}
