'use client'

/**
 * HomePersonalization
 *
 * "For You 🔥" feed — personalized, pet-guided, intent-aware.
 *
 * Architecture
 * ────────────
 * 1. useInterests    — explicit user preferences
 * 2. useTasteProfile — implicit behavior profile (click counts)
 * 3. ScoreContext    — merged snapshot, stable per session
 * 4. scoreItem()     — deterministic multi-signal scorer
 * 5. reasonFor()     — per-card "why" label
 * 6. parseIntent()   — rule-based NL parser → structured filters
 * 7. intentBoost()   — extra score bonus for intent matches
 * 8. PetAssistantBar — persistent bar, never auto-dismisses
 * 9. PetChatPanel    — full localStorage-backed chat history modal
 * 10. IntentBar      — free-text assistant input
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Settings2, MapPin, Clock, Sparkles, X, ArrowRight, ChevronRight } from 'lucide-react'
import dynamic from 'next/dynamic'

import { useInterests }    from '@/hooks/useInterests'
import { useTasteProfile, getDominantTaste, tasteSummary, topNKeys } from '@/hooks/useTasteProfile'
import { parseIntent, buildIntentResponse, type ParsedIntent } from '@/lib/intent-parser'
import {
  buildScoreContext,
  scoreItem,
  reasonFor,
  fetchScoredFeed,
  pickTopAndBackups,
  applyImpressionPenalty,
  haversineKm,
  type ScoreContext,
  type ScoredItem,
} from '@/lib/recommendations'
import { getSeenIds, markSeen, trackImpression, getOvershownIds, getViewedIds } from '@/lib/session-seen'
import { track } from '@vercel/analytics'
import { Item, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { formatTime, cn } from '@/lib/utils'

const InterestsOnboarding = dynamic(
  () => import('@/components/InterestsOnboarding'),
  { ssr: false },
)

// ── Intent scoring helpers ────────────────────────────────────────────────────
//
// intentBoost v2: vibe alignment now dominates behavioral preference when
// the user's intent is strong.  Two or more vibe-tag matches unlock a +8
// alignment bonus that reliably overrides a food/events behavioral advantage.

function intentBoost(item: Item, intent: ParsedIntent): number {
  let boost    = 0
  const tags   = (item.tags ?? []).map(t => t.toLowerCase())
  const now    = Date.now()

  // Vibe alignment: each matching tag adds +4; two+ matching tags adds an
  // extra +8 bonus to ensure vibe-heavy intent overrides behavioral category.
  if (intent.vibes.length > 0) {
    const vibeTagHits = intent.tags.filter(t => tags.includes(t)).length
    boost += vibeTagHits * 4
    if (vibeTagHits >= 2) boost += 8   // strong alignment bonus
  } else {
    // No vibes — standard tag boost for non-vibe tag matches
    boost += tags.filter(t => intent.tags.includes(t)).length * 3
  }

  // Explicit category: strongest intent signal
  if (intent.categories.includes(item.category)) boost += 8   // up from +5

  // Temporal — imminent events score highest, not just "today"
  if (intent.time === 'today' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - now) / 3_600_000
    if (h > 0 && h <= 3)  boost += 8   // starting very soon
    else if (h > 0 && h <= 12) boost += 5
    else if (h > 0 && h <= 24) boost += 3
  }

  // Free items when budget=free signal
  if (intent.budget === 'free' && tags.includes('free')) boost += 5

  return boost
}

// intentReason v2: specific about what matched rather than generic labels
function intentReason(item: Item, intent: ParsedIntent): string | null {
  const tags = (item.tags ?? []).map(t => t.toLowerCase())
  const now  = Date.now()

  // Time-specific (most actionable)
  if (intent.time === 'today' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - now) / 3_600_000
    if (h > 0 && h <= 3) {
      const mins = Math.round(h * 60)
      return `starts in ${mins}m`
    }
    if (h > 0 && h <= 24) {
      const d = new Date(item.start_time)
      const hr = d.getHours(); const mn = d.getMinutes()
      const ampm = hr >= 12 ? 'pm' : 'am'
      const h12  = hr % 12 || 12
      const time = mn === 0 ? `${h12}${ampm}` : `${h12}:${String(mn).padStart(2,'0')}${ampm}`
      return `tonight · ${time}`
    }
  }

  // Free — high-value signal for students
  if (intent.budget === 'free' && tags.includes('free')) return 'free to attend'

  // Campus proximity
  if (intent.region === 'on-campus') {
    if (item.latitude != null && item.longitude != null) {
      const km = haversineKm(UC_DAVIS_LAT, UC_DAVIS_LNG, item.latitude, item.longitude)
      if (km < 0.5) return 'on campus'
      if (km < 1.5) return 'close to campus'
    }
    if (tags.includes('on-campus')) return 'on campus'
    return 'near campus'
  }

  // Vibe matches — specific tag rather than generic label
  if (intent.vibes.includes('chill') && tags.some(t => ['outdoor', 'quiet', 'coffee', 'cafe', 'study-spot', 'park'].includes(t)))
    return 'chill spot'
  if (intent.vibes.includes('social') && tags.some(t => ['social-party', 'live-music', 'student-friendly'].includes(t)))
    return 'social scene'
  if (intent.vibes.includes('outdoorsy') && item.category === 'outdoor')
    return 'outdoor spot'
  if (intent.vibes.includes('cozy') && tags.some(t => ['cafe', 'coffee', 'quiet'].includes(t)))
    return 'cozy spot'

  // Category match
  if (intent.categories.includes(item.category)) return 'matches what you asked'

  return null
}

// ── Chip filter ───────────────────────────────────────────────────────────────
//
// Chips now FILTER the candidate pool instead of adding a small score bonus.
// This makes each chip produce a meaningfully different set of recommendations,
// not just a slightly reshuffled version of the same list.
//
// Algorithm:
//   1. Partition scored feed into matching / non-matching items.
//   2. Sort each partition by base score (personalisation preserved within filter).
//   3. Return matching items first — non-matching items follow as fallback.
//   4. If < 3 matching items exist, the fallback items fill the display gracefully.
//
// Contrast with the old applyChipBoost approach:
//   Old: add +10–12 to matching items → food-heavy user (base +10-12) still
//        beats campus items (+10 chip) because scores overlap.
//   New: matching items are always presented first regardless of base score,
//        so "Near campus" always shows campus items as the top picks.

export type ChipFilter = 'tonight' | 'food' | 'chill' | 'campus' | null

function applyChipFilter(scored: ScoredItem[], chip: ChipFilter): ScoredItem[] {
  if (!chip) return scored
  const now = Date.now()

  function matchesChip(s: ScoredItem): boolean {
    const tags = (s.item.tags ?? []).map(t => t.toLowerCase())
    switch (chip) {
      case 'tonight': {
        if (!s.item.start_time) return false
        const h = (new Date(s.item.start_time).getTime() - now) / 3_600_000
        return h > 0 && h < 24
      }
      case 'food':
        return s.item.category === 'food'
      case 'chill':
        return (
          s.item.category === 'outdoor' ||
          s.item.category === 'study' ||
          tags.some(t => ['outdoor', 'quiet', 'cafe', 'coffee', 'study-spot', 'park', 'peaceful', 'scenic'].includes(t))
        )
      case 'campus':
        return (
          s.item.category === 'campus' ||
          tags.some(t => ['on-campus', 'near-campus', 'student-friendly', 'ucd'].includes(t)) ||
          (s.item.latitude != null && s.item.longitude != null &&
           haversineKm(UC_DAVIS_LAT, UC_DAVIS_LNG, s.item.latitude, s.item.longitude) < 1.5)
        )
      default:
        return false
    }
  }

  const matching    = scored.filter(s =>  matchesChip(s)).sort((a, b) => b.score - a.score)
  const nonMatching = scored.filter(s => !matchesChip(s)).sort((a, b) => b.score - a.score)

  // Matching items always come first — non-matching items act as a graceful
  // fallback so the section never appears empty (e.g. no tonight events).
  return [...matching, ...nonMatching]
}

// ── Chat memory ───────────────────────────────────────────────────────────────
//
// Stored in localStorage under `nearu-pet-chat`.
// Format: { messages: [{ text, items, ts }] }
// Newest first; capped at 20 entries; never auto-deleted.

const CHAT_KEY = 'nearu-pet-chat'
const CHAT_MAX = 20

interface ChatItem {
  id:              string
  title:           string
  category:        string
  flyer_image_url?: string | null
}

interface ChatMessage {
  text:  string
  items: ChatItem[]
  ts:    number
}

function loadChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.messages) ? parsed.messages : []
  } catch { return [] }
}

function appendChat(msg: ChatMessage): void {
  try {
    const existing = loadChat()
    const updated  = [msg, ...existing].slice(0, CHAT_MAX)
    localStorage.setItem(CHAT_KEY, JSON.stringify({ messages: updated }))
  } catch {}
}

// ── Colour gradients ──────────────────────────────────────────────────────────

const CAT_GRADIENT: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

// ── Pet Assistant Bar ─────────────────────────────────────────────────────────
// Persistent: never auto-disappears. Message updates when user interacts.

function PetAssistantBar({
  message,
  onOpenChat,
}: {
  message:     string
  onOpenChat:  () => void
}) {
  return (
    <div className="flex items-start gap-2.5 mb-3 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-xl">
      <span className="text-[16px] shrink-0 select-none mt-0.5" aria-hidden>🐾</span>
      <p className="flex-1 text-[12px] text-[#92400E] font-medium leading-snug min-w-0">
        {message}
      </p>
      <button
        onClick={onOpenChat}
        className="inline-flex items-center gap-0.5 shrink-0 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors whitespace-nowrap mt-0.5"
      >
        view chat
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  )
}

// ── Mini card for chat panel ──────────────────────────────────────────────────

function ChatMiniCard({ item, onClose }: { item: ChatItem; onClose: () => void }) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={onClose}
      className="flex items-center gap-2.5 bg-white border border-[#F3F4F6] rounded-xl px-3 py-2 hover:border-[#E5E7EB] hover:bg-[#FAFAFA] transition-all group"
    >
      {item.flyer_image_url ? (
        <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0">
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover"
            sizes="32px"
          />
        </div>
      ) : (
        <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0', gradient)}>
          <span className="text-[13px] opacity-60">{cat?.icon ?? '📌'}</span>
        </div>
      )}
      <span className="text-[12px] font-medium text-[#374151] group-hover:text-[#111111] line-clamp-1 flex-1 min-w-0">
        {item.title}
      </span>
      <ArrowRight className="w-3 h-3 text-[#C4C9D4] group-hover:text-[#9CA3AF] shrink-0" />
    </Link>
  )
}

// ── Pet Chat Panel ────────────────────────────────────────────────────────────
// Bottom sheet on mobile, centred modal on desktop.
// Shows full localStorage chat history with item cards per message.

function PetChatPanel({
  messages,
  onClose,
}: {
  messages: ChatMessage[]
  onClose:  () => void
}) {
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="relative w-full max-w-[480px] max-h-[82vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-up">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#F3F4F6] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[20px] select-none" aria-hidden>🐾</span>
            <div>
              <p className="text-[14px] font-bold text-[#111111]">Pet Assistant</p>
              <p className="text-[11px] text-[#9CA3AF]">your companion's memory</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] transition-colors text-[#6B7280]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
              <span className="text-[44px]" aria-hidden>🐾</span>
              <p className="text-[13px] font-semibold text-[#374151]">Nothing yet</p>
              <p className="text-[12px] text-[#9CA3AF] max-w-[240px]">
                Save, share, or search something — your companion will remember it here
              </p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={`${msg.ts}-${i}`}>
                {/* Pet bubble */}
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-[14px] shrink-0 mt-0.5 select-none" aria-hidden>🐾</span>
                  <div className="flex-1 min-w-0">
                    <div className="inline-block bg-amber-50 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-2 mb-1 max-w-full">
                      <p className="text-[13px] text-[#92400E] font-medium leading-snug">{msg.text}</p>
                    </div>
                    <p className="text-[10px] text-[#C4C9D4] ml-1">{fmtTime(msg.ts)}</p>
                  </div>
                </div>
                {/* Cards */}
                {msg.items.length > 0 && (
                  <div className="ml-6 flex flex-col gap-1.5">
                    {msg.items.slice(0, 3).map(item => (
                      <ChatMiniCard key={item.id} item={item} onClose={onClose} />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-[#F3F4F6] bg-[#FAFAFA] shrink-0">
          <p className="text-[11px] text-[#C4C9D4] text-center">
            Try: &ldquo;chill tonight&rdquo; · &ldquo;free food near campus&rdquo;
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Assistant quick-action chips ─────────────────────────────────────────────
//
// Scoring chips — not navigation links.
// Each chip applies a large score boost to matching items and immediately
// re-renders Top Pick + Backup Picks without a page reload.
// Clicking the active chip again de-selects it.

const CHIP_DEFS: { id: ChipFilter; label: string; cat?: string }[] = [
  { id: 'tonight', label: '🌙 Tonight',     cat: 'events'  },
  { id: 'food',    label: '🍜 Food spots',  cat: 'food'    },
  { id: 'chill',   label: '🌿 Chill spots', cat: 'outdoor' },
  { id: 'campus',  label: '📍 Near campus'                 },
]

function AssistantActions({
  dominantCat,
  activeChip,
  onChipSelect,
}: {
  dominantCat:  string | null
  activeChip:   ChipFilter
  onChipSelect: (chip: ChipFilter) => void
}) {
  const sorted = useMemo(() => {
    if (!dominantCat) return CHIP_DEFS
    return [
      ...CHIP_DEFS.filter(a => a.cat === dominantCat),
      ...CHIP_DEFS.filter(a => a.cat !== dominantCat),
    ]
  }, [dominantCat])

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5 -mx-6 px-6 mb-4">
      {sorted.map(a => (
        <button
          key={a.id}
          onClick={() => onChipSelect(activeChip === a.id ? null : a.id)}
          className={cn(
            'flex-none text-[12px] font-medium rounded-full px-3 py-1 transition-all whitespace-nowrap',
            activeChip === a.id
              ? 'bg-[#111111] text-white shadow-sm'
              : 'bg-white border border-[#E5E7EB] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB] hover:shadow-sm',
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  item:       Item
  reason?:    string | null
  showBadge?: boolean
  onClick?:   (item: Item) => void
}

function ForYouCard({ item, reason, showBadge, onClick }: CardProps) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={() => onClick?.(item)}
      className="group h-[260px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image — always 140px */}
      <div className={cn('relative h-[140px] w-full shrink-0 overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        {showBadge && (
          <div className="absolute top-2 left-2">
            <span className="text-[9px] font-medium text-amber-700 bg-white/90 border border-amber-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
              🐾 For You
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col p-3 flex-1 overflow-hidden">
        <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 h-[40px] group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>
        {/* Fixed-height reason row — always reserves space to keep card body uniform */}
        <p className="text-[10px] text-[#9CA3AF] mt-0.5 leading-tight truncate h-[14px]">
          {reason ?? ''}
        </p>
        <div className="mt-auto">
          <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] overflow-hidden">
            {loc && <MapPin className="w-2.5 h-2.5 shrink-0" />}
            <span className="truncate">{loc}</span>
          </p>
          <div className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] mt-0.5">
            {time ? (
              <>
                <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
                <span>{time}</span>
              </>
            ) : (
              <span className="text-[#9CA3AF] capitalize">{item.category}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="h-[260px] bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden animate-pulse">
      <div className="h-[140px] bg-[#F3F4F6]" />
      <div className="p-3 flex flex-col gap-2 mt-1">
        <div className="h-3 bg-[#F3F4F6] rounded w-3/4" />
        <div className="h-2.5 bg-[#F3F4F6] rounded w-1/2" />
      </div>
    </div>
  )
}

// ── Top Pick card ─────────────────────────────────────────────────────────────
// Full-width hero card: large image, reason pill, strong "View →" CTA.

function TopPickCard({
  item,
  reason,
  onClick,
}: {
  item:    Item
  reason?: string | null
  onClick?: (item: Item) => void
}) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={() => { track('pick_click', { slot: 'top', item_id: item.id, category: item.category ?? '' }); onClick?.(item) }}
      className="group relative w-full bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image — taller than the grid cards */}
      <div className={cn('relative h-[190px] w-full shrink-0 overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="(max-width:640px) 100vw, 75vw"
            priority
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl opacity-30 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        {/* Top Pick badge */}
        <div className="absolute top-3 left-3">
          <span className="text-[10px] font-bold text-white bg-black/70 backdrop-blur-sm rounded-full px-2 py-0.5 uppercase tracking-wide">
            Top Pick
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col p-4 flex-1">
        <h3 className="text-[15px] font-bold text-[#111111] leading-snug line-clamp-2 mb-2 group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>

        {/* Reason pill */}
        {reason && (
          <span className="inline-flex items-center self-start text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5 mb-3">
            🐾 {reason}
          </span>
        )}

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            {loc && (
              <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] truncate">
                <MapPin className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{loc}</span>
              </p>
            )}
            {time ? (
              <p className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
                <span>{time}</span>
              </p>
            ) : (
              <p className="text-[11px] text-[#9CA3AF] capitalize">{cat?.label ?? item.category}</p>
            )}
          </div>

          {/* CTA */}
          <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-[#111111] bg-[#F3F4F6] group-hover:bg-[#E5E7EB] rounded-full px-3.5 py-1.5 transition-colors whitespace-nowrap">
            View
            <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── Backup Pick card ──────────────────────────────────────────────────────────
// Horizontal card: thumbnail + text. Secondary weight vs. Top Pick.

function BackupPickCard({
  item,
  reason,
  onClick,
}: {
  item:    Item
  reason?: string | null
  onClick?: (item: Item) => void
}) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={() => { track('pick_click', { slot: 'backup', item_id: item.id, category: item.category ?? '' }); onClick?.(item) }}
      className="group bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-row gap-3 p-3"
    >
      {/* Thumbnail */}
      <div className={cn('relative w-[72px] h-[72px] shrink-0 rounded-xl overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="72px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
      </div>

      {/* Text */}
      <div className="flex flex-col flex-1 min-w-0 justify-between py-0.5">
        <div>
          <div className="flex items-start justify-between gap-1">
            <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 flex-1 group-hover:text-[#333] transition-colors">
              {item.title}
            </h3>
            <ArrowRight className="w-3 h-3 text-[#C4C9D4] group-hover:text-[#9CA3AF] shrink-0 mt-0.5" />
          </div>
          {reason && (
            <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate">{reason}</p>
          )}
        </div>
        <p className="text-[11px] text-[#9CA3AF] flex items-center gap-1 mt-1.5">
          {time ? (
            <>
              <Clock className="w-2.5 h-2.5 shrink-0" />
              <span>{time}</span>
            </>
          ) : loc ? (
            <>
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{loc}</span>
            </>
          ) : (
            <span className="capitalize">{cat?.label ?? item.category}</span>
          )}
        </p>
      </div>
    </Link>
  )
}

// ── Top-Pick skeleton ─────────────────────────────────────────────────────────

function TopPickSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="w-full h-[280px] bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
        <div className="h-[190px] bg-[#F3F4F6]" />
        <div className="p-4 flex flex-col gap-2">
          <div className="h-4 bg-[#F3F4F6] rounded w-3/4" />
          <div className="h-3 bg-[#F3F4F6] rounded w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map(i => (
          <div key={i} className="h-[96px] bg-white rounded-2xl border border-[#E5E7EB]" />
        ))}
      </div>
    </div>
  )
}

// ── Feed section (Top Pick hierarchy) ────────────────────────────────────────
//
// Shows: 1 Top Pick (large hero card) + 2 Backup Picks (horizontal cards).
// Applies chip boost before picking so chips have an immediate visible effect.
// Registers shown items into the session-seen set for cross-surface dedup.

interface FeedProps {
  savedTags:   string[]
  savedCats:   string[]
  ctx:         ScoreContext
  activeChip:  ChipFilter
  recordClick: (item: Item) => void
}

function ForYouSection({ savedTags, savedCats, ctx, activeChip, recordClick }: FeedProps) {
  const [baseScored, setBaseScored] = useState<ScoredItem[]>([])
  const [loading, setLoading]       = useState(true)

  // Load once on hydration — chip changes re-derive picks from cached baseScored
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await fetchScoredFeed(ctx, savedTags, 24)
        if (!cancelled) setBaseScored(result)
      } catch {
        // silent — network blip should not break the homepage
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTags.join(','), savedCats.join(',')])

  const { top, backups } = useMemo(() => {
    // Apply impression penalty before chip filter + diversity pass.
    // Viewed items (user opened the listing) get half the penalty so genuine
    // interest isn't punished by repeated-exposure logic.
    const overshown = getOvershownIds(4)
    const viewed    = getViewedIds()
    const penalised = applyImpressionPenalty(baseScored, overshown, viewed)
    const filtered  = applyChipFilter(penalised, activeChip)
    const seenIds   = getSeenIds()
    // Pass ctx so pickTopAndBackups can compute the dynamic diversity cap
    return pickTopAndBackups(filtered, seenIds, 2, ctx)
  }, [baseScored, activeChip, ctx])

  // Register shown items so /for-you page's featured section won't repeat them.
  // Track impressions with first-screen weight (all featured picks are above the fold).
  useEffect(() => {
    const ids: string[] = []
    if (top) ids.push(top.item.id)
    backups.forEach(b => ids.push(b.item.id))
    if (ids.length > 0) {
      markSeen(ids)
      trackImpression(ids, ids.length)   // all first-screen — weight 2 each
    }
  }, [top, backups])

  if (loading) return <TopPickSkeleton />
  if (!top)    return null

  return (
    <div className="flex flex-col gap-3">
      {/* Top Pick — full width, most prominent */}
      <TopPickCard item={top.item} reason={top.reason} onClick={recordClick} />

      {/* Backup Picks — side by side below */}
      {backups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {backups.map(b => (
            <BackupPickCard key={b.item.id} item={b.item} reason={b.reason} onClick={recordClick} />
          ))}
        </div>
      )}

      {/* See all link */}
      <div className="flex justify-center mt-1">
        <Link
          href="/for-you"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#9CA3AF] hover:text-[#374151] transition-colors"
        >
          See more picks
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

// ── Intent input bar ─────────────────────────────────────────────────────────

interface IntentBarProps {
  intentMode: boolean
  loading:    boolean
  onSubmit:   (query: string) => void
  onClear:    () => void
}

function IntentBar({ intentMode, loading, onSubmit, onClear }: IntentBarProps) {
  const [value, setValue] = useState('')
  useEffect(() => { if (!intentMode) setValue('') }, [intentMode])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (q) onSubmit(q)
  }

  return (
    <div className="mb-4">
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            'flex items-center gap-2 bg-white border rounded-2xl px-3 py-2.5 shadow-sm transition-all',
            intentMode
              ? 'border-amber-300 ring-1 ring-amber-200/60'
              : 'border-[#E5E7EB] focus-within:border-amber-300 focus-within:ring-1 focus-within:ring-amber-200/60',
          )}
        >
          <span className="text-[15px] select-none shrink-0" aria-hidden>🐾</span>
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="What are you looking for? e.g. 'chill tonight', 'free food'"
            className="flex-1 text-[13px] text-[#111111] placeholder-[#C4C9D4] bg-transparent outline-none min-w-0"
            disabled={loading}
            aria-label="Assistant search"
          />
          {intentMode ? (
            <button
              type="button"
              onClick={() => { setValue(''); onClear() }}
              className="shrink-0 text-[11px] font-medium text-[#9CA3AF] hover:text-[#374151] transition-colors whitespace-nowrap"
            >
              ✕ clear
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim() || loading}
              className="shrink-0 text-[13px] font-bold text-[#D97706] hover:text-[#B45309] disabled:opacity-30 transition-colors"
              aria-label="Submit"
            >
              {loading ? '…' : <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </form>
      {!intentMode && (
        <p className="text-[10px] text-[#C4C9D4] mt-1.5 ml-2">
          try: &quot;chill tonight&quot; · &quot;free food near campus&quot; · &quot;something social&quot;
        </p>
      )}
    </div>
  )
}

// ── Intent results ────────────────────────────────────────────────────────────

interface IntentResultsProps {
  scored:      ScoredItem[]
  onClear:     () => void
  recordClick: (item: Item) => void
}

function IntentResults({ scored, onClear, recordClick }: IntentResultsProps) {
  if (scored.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-[#9CA3AF] mb-3">No great matches — try different words</p>
        <button
          onClick={onClear}
          className="text-[12px] font-medium text-[#D97706] hover:text-[#B45309] transition-colors"
        >
          ← Back to For You
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {scored.map(({ item, reason }, idx) => (
          <ForYouCard
            key={item.id}
            item={item}
            reason={reason}
            showBadge={idx < 3}
            onClick={recordClick}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          onClick={onClear}
          className="text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
        >
          ← Back to For You
        </button>
      </div>
    </>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HomePersonalization() {
  const {
    interests,
    hasInterests,
    shouldShowOnboarding,
    hydrated: interestsHydrated,
    allTags,
    dismiss,
  } = useInterests()

  const { profile, recordClick } = useTasteProfile()

  // Records the taste-profile signal (category/tag counters for future scoring).
  // The detail-view signal (impression-penalty protection) is recorded by
  // ViewTracker on the listing page mount — not here — so it only fires when
  // the user actually reaches the page, not on optimistic card clicks.
  const handleCardClick = useCallback((item: Item) => {
    recordClick(item)
  }, [recordClick])

  const [showModal, setShowModal] = useState(false)

  // ── Persistent assistant bar ──────────────────────────────────────────────
  // Never auto-clears — only changes when user interacts or hydrates.
  const [assistantMsg, setAssistantMsg] = useState('here\'s something good for you 🐾')
  const [chatOpen, setChatOpen]         = useState(false)
  const [chatHistory, setChatHistory]   = useState<ChatMessage[]>([])

  // Debounce refs: prevent rapid pet:message overwrites; guard hydration vs user messages
  const msgDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUserMsgAtRef  = useRef<number>(0)  // timestamp of last user-action message

  // ── Intent state ──────────────────────────────────────────────────────────
  const [intentMode, setIntentMode]       = useState(false)
  const [intentLoading, setIntentLoading] = useState(false)
  const [intentScored, setIntentScored]   = useState<ScoredItem[]>([])

  // ── Chip filter ──────────────────────────────────────────────────────────
  const [activeChip, setActiveChip] = useState<ChipFilter>(null)

  const dominantCat = getDominantTaste(profile)

  const ctx = useMemo(
    () => buildScoreContext(interests, profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      allTags.join(','),
      interests.categories.join(','),
      topNKeys(profile.categoryCounts, 3).join(','),
      topNKeys(profile.tagCounts, 10).join(','),
    ],
  )

  // Bridge: receive pet reaction messages from PetWidget (save/share/calendar on any page)
  // Debounced 400ms — prevents rapid saves/shares from flickering the bar.
  // PetWidget already wrote to localStorage; we just sync state here.
  useEffect(() => {
    function onPetMessage(e: Event) {
      const { text } = (e as CustomEvent<{ text: string }>).detail
      if (!text) return
      if (msgDebounceRef.current) clearTimeout(msgDebounceRef.current)
      msgDebounceRef.current = setTimeout(() => {
        setAssistantMsg(text)
        setChatHistory(loadChat())
        lastUserMsgAtRef.current = Date.now()
      }, 400)
    }
    window.addEventListener('pet:message', onPetMessage)
    return () => {
      window.removeEventListener('pet:message', onPetMessage)
      if (msgDebounceRef.current) clearTimeout(msgDebounceRef.current)
    }
  }, [])

  // On hydration: load chat, set taste-aware assistant message.
  // Guard: don't overwrite if a user-action message arrived in the last 30s.
  useEffect(() => {
    if (!interestsHydrated) return
    if (shouldShowOnboarding) setShowModal(true)
    setChatHistory(loadChat())

    // If a real action message came through recently, leave it — don't replace with ambient
    if (Date.now() - lastUserMsgAtRef.current < 30_000) return

    const now     = new Date().getHours()
    const summary = tasteSummary(profile)
    if (summary) {
      setAssistantMsg(`you always end up around ${summary} 😌`)
    } else if (now >= 17) {
      setAssistantMsg('you might like these tonight 👀')
    } else if (now >= 12) {
      setAssistantMsg('picked some things for you 🎯')
    } else {
      setAssistantMsg("here's what's on today 🌅")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interestsHydrated])

  // Stable ref to ctx so intent handler doesn't need ctx in its dep array
  const ctxRef = useRef(ctx)
  useEffect(() => { ctxRef.current = ctx }, [ctx])

  // ── Intent submit handler ─────────────────────────────────────────────────
  //
  // FIX: removed the setIntentMode(false) call that was here previously.
  // That flip triggered IntentBar's !intentMode useEffect and cleared the input
  // value immediately while the fetch was still in-flight — the user's query
  // disappeared mid-loading.  Input clearing now happens naturally when the user
  // clicks "✕ clear" (onClear → setIntentMode(false)).
  const handleIntentSubmit = useCallback(async (query: string) => {
    setIntentLoading(true)

    try {
      const intent     = parseIntent(query)
      const currentCtx = ctxRef.current

      const params = new URLSearchParams({ limit: '60', sort: 'recent' })
      if (intent.categories.length === 1) params.set('category', intent.categories[0])
      if (intent.time)                    params.set('time', intent.time)
      if (intent.budget === 'free')       params.append('tag', 'free')
      if (intent.region === 'on-campus' || intent.region === 'davis') {
        params.set('lat', String(UC_DAVIS_LAT))
        params.set('lng', String(UC_DAVIS_LNG))
        params.set('radius', intent.region === 'on-campus' ? '1' : '5')
      }

      const res           = await fetch(`/api/items?${params}`)
      const items: Item[] = res.ok ? await res.json() : []

      const scored: ScoredItem[] = items
        .filter(item => !intent.exclusions.includes(item.category))
        .map(item => ({
          item,
          score:  scoreItem(item, currentCtx) + intentBoost(item, intent),
          reason: intentReason(item, intent) ?? reasonFor(item, currentCtx),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)

      const msg = buildIntentResponse(intent, scored.length)

      // Update persistent assistant bar — no timer, stays until next interaction
      setAssistantMsg(msg)

      // Save to localStorage chat history with top-2 items (focused, not overwhelming)
      const chatMsg: ChatMessage = {
        text:  msg,
        items: scored.slice(0, 2).map(s => ({
          id:              s.item.id,
          title:           s.item.title,
          category:        s.item.category,
          flyer_image_url: s.item.flyer_image_url,
        })),
        ts: Date.now(),
      }
      appendChat(chatMsg)
      setChatHistory(loadChat())

      setIntentScored(scored)
      setIntentMode(true)
    } catch {
      // silent
    } finally {
      setIntentLoading(false)
    }
  }, [])

  const handleIntentClear = useCallback(() => {
    setIntentMode(false)
    setIntentScored([])
  }, [])

  // ── Chip select handler ──────────────────────────────────────────────────
  const CHIP_MESSAGES: Record<NonNullable<ChipFilter>, string> = {
    tonight: "here's what's on tonight 🌙",
    food:    "some solid food spots for you 🍜",
    chill:   "low-key picks — take it easy 🌿",
    campus:  "stuff close to campus 📍",
  }

  const handleChipSelect = useCallback((chip: ChipFilter) => {
    setActiveChip(chip)
    if (chip) {
      setAssistantMsg(CHIP_MESSAGES[chip])
    } else {
      // Restore contextual message when chip is cleared
      const now     = new Date().getHours()
      const summary = tasteSummary(profile)
      if (summary)        setAssistantMsg(`you always end up around ${summary} 😌`)
      else if (now >= 17) setAssistantMsg('you might like these tonight 👀')
      else if (now >= 12) setAssistantMsg('picked some things for you 🎯')
      else                setAssistantMsg("here's what's on today 🌅")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  return (
    <>
      {/* ── For You 🔥 ─────────────────────────────────────────────────────────── */}
      <section className="mb-10">

        {/* Header row: title + "See all" + "Edit" */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-[#111111] leading-none">For You 🔥</h2>
            <Link
              href="/for-you"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#9CA3AF] hover:text-[#374151] transition-colors"
            >
              See all
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {interestsHydrated && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {hasInterests ? 'Edit' : 'Set up'}
            </button>
          )}
        </div>

        {/* Persistent pet assistant bar — never auto-disappears */}
        <PetAssistantBar
          message={assistantMsg}
          onOpenChat={() => setChatOpen(true)}
        />

        {/* Quick action chips — click to boost scoring, not navigate */}
        <AssistantActions
          dominantCat={dominantCat}
          activeChip={activeChip}
          onChipSelect={handleChipSelect}
        />

        {/* ChatGPT-lite intent input */}
        <IntentBar
          intentMode={intentMode}
          loading={intentLoading}
          onSubmit={handleIntentSubmit}
          onClear={handleIntentClear}
        />

        {/* Feed: skeleton while hydrating, intent results or For You cards after */}
        {!interestsHydrated ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : intentMode ? (
          <IntentResults
            scored={intentScored}
            onClear={handleIntentClear}
            recordClick={handleCardClick}
          />
        ) : (
          <ForYouSection
            savedTags={allTags}
            savedCats={interests.categories}
            ctx={ctx}
            activeChip={activeChip}
            recordClick={handleCardClick}
          />
        )}

        {/* Subtle personalise nudge — only if no interests set */}
        {interestsHydrated && !hasInterests && !showModal && (
          <div className="flex items-center justify-between mt-3 px-1">
            <p className="text-[11px] text-[#C4C9D4]">
              We&apos;ll learn what you like as you browse 🐾
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 text-[11px] font-semibold text-[#D97706] hover:text-[#B45309] transition-colors shrink-0"
            >
              <Sparkles className="w-3 h-3" />
              Personalise
            </button>
          </div>
        )}
      </section>

      {/* ── Interests onboarding modal ────────────────────────────────────────── */}
      {showModal && (
        <InterestsOnboarding
          onClose={() => {
            setShowModal(false)
            dismiss()
          }}
        />
      )}

      {/* ── Pet chat panel ────────────────────────────────────────────────────── */}
      {chatOpen && (
        <PetChatPanel
          messages={chatHistory}
          onClose={() => setChatOpen(false)}
        />
      )}
    </>
  )
}
