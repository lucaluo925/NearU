'use client'

/**
 * /for-you — dedicated personalized recommendation page.
 *
 * Mirrors the homepage For You section exactly:
 *   - same ForYouCard (h-[260px], h-[140px] image, fixed-height body)
 *   - same grid layout (grid-cols-2 md:grid-cols-3 lg:grid-cols-4, gap-4)
 *   - persistent pet assistant bar (loads last localStorage message)
 *   - same intent input bar as homepage
 *   - pet chat history modal (role-aware: user + assistant bubbles)
 *   - infinite scroll via IntersectionObserver
 *   - quick filter chips
 *   - fetches 40 items
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  type ScoreContext,
  type ScoredItem,
} from '@/lib/recommendations'
import { getSeenIds, markSeen } from '@/lib/session-seen'
import { Item, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { formatTime, cn, startOfLADay, endOfLADay } from '@/lib/utils'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

const InterestsOnboarding = dynamic(
  () => import('@/components/InterestsOnboarding'),
  { ssr: false },
)

// ── Chat memory ───────────────────────────────────────────────────────────────

const CHAT_KEY = 'nearu-pet-chat'
const CHAT_MAX = 40   // increased to hold user + assistant messages

interface ChatItem {
  id:               string
  title:            string
  category:         string
  flyer_image_url?: string | null
}

/**
 * role is optional for backward-compat with messages stored before this update.
 * Treat missing role as 'assistant'.
 * source documents why the message exists (aids context preservation).
 */
interface ChatMessage {
  role?:   'user' | 'assistant' | 'system'
  text:    string
  items:   ChatItem[]
  ts:      number
  source?: 'intent' | 'ambient' | 'recommendation' | 'pet-event'
}

function loadChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.messages) ? parsed.messages : []
  } catch { return [] }
}

/**
 * Append one or more messages to chat history.
 *
 * Dedup rules (prevent repetitive spam):
 *  - If an 'assistant' message with the same text AND same item-id fingerprint
 *    already exists in the last 10 entries within the past 30 minutes, skip it.
 *  - 'user' messages are always kept (conversation context).
 */
function appendChat(msgs: ChatMessage[]): void {
  try {
    const existing = loadChat()
    const thirtyMin = 30 * 60_000

    const toAdd = msgs.filter(msg => {
      // Always keep user messages — they provide conversation context
      if (!msg.role || msg.role === 'user') return true

      const itemFingerprint = msg.items.map(i => i.id).sort().join(',')
      const recent = existing.slice(0, 10)

      const isDupe = recent.some(m => {
        if ((m.role ?? 'assistant') !== 'assistant') return false
        if (m.text !== msg.text) return false
        const mFp = m.items.map(i => i.id).sort().join(',')
        if (mFp !== itemFingerprint) return false
        return (msg.ts - m.ts) < thirtyMin
      })
      return !isDupe
    })

    if (toAdd.length === 0) return
    const updated = [...toAdd, ...existing].slice(0, CHAT_MAX)
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

// ── Intent scoring helpers ────────────────────────────────────────────────────

function intentBoost(item: Item, intent: ParsedIntent): number {
  let boost = 0
  const itemTags = (item.tags ?? []).map(t => t.toLowerCase())
  if (intent.categories.includes(item.category))                    boost += 5
  boost += itemTags.filter(t => intent.tags.includes(t)).length * 3
  if (intent.time === 'today' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h > 0 && h < 24) boost += 4
  } else if (intent.time === 'tomorrow' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h >= 24 && h < 48) boost += 4
  }
  return boost
}

function intentReason(item: Item, intent: ParsedIntent): string | null {
  const itemTags = (item.tags ?? []).map(t => t.toLowerCase())
  if (intent.vibes.includes('chill') && itemTags.some(t => ['outdoor', 'quiet', 'coffee', 'cafe', 'study-spot'].includes(t)))
    return 'Chill vibes ✓'
  if (intent.vibes.includes('social') && itemTags.some(t => ['social-party', 'live-music', 'student-friendly'].includes(t)))
    return 'Social vibes ✓'
  if (intent.vibes.includes('outdoorsy') && item.category === 'outdoor')
    return 'Outdoor ✓'
  if (intent.budget === 'free' && itemTags.includes('free'))
    return 'Free to attend'
  if (intent.time === 'today' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h > 0 && h < 24) return 'Happening tonight'
  } else if (intent.time === 'tomorrow' && item.start_time) {
    return 'Happening tomorrow'
  }
  if (intent.region === 'on-campus') return 'Near campus'
  if (intent.categories.includes(item.category)) return 'Matches what you asked'
  return null
}

// ── Pet Assistant Bar ─────────────────────────────────────────────────────────

function PetAssistantBar({
  message,
  onOpenChat,
}: {
  message:    string
  onOpenChat: () => void
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
          <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover" sizes="32px" />
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

function PetChatPanel({
  messages,
  onClose,
}: {
  messages: ChatMessage[]
  onClose:  () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Display oldest-first so the conversation reads naturally top-to-bottom
  const displayMessages = [...messages].reverse()

  // Scroll to bottom (latest message) when panel opens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

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
              <p className="text-[11px] text-[#9CA3AF]">your companion&apos;s memory</p>
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

        {/* Messages — oldest at top, newest at bottom */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {displayMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
              <span className="text-[44px]" aria-hidden>🐾</span>
              <p className="text-[13px] font-semibold text-[#374151]">Nothing yet</p>
              <p className="text-[12px] text-[#9CA3AF] max-w-[240px]">
                Try searching below — your companion will remember it here
              </p>
            </div>
          ) : (
            displayMessages.map((msg, i) => {
              const role = msg.role ?? 'assistant'

              if (role === 'user') {
                return (
                  <div key={`${msg.ts}-${i}`} className="flex justify-end">
                    <div className="max-w-[75%]">
                      <div className="inline-block bg-[#111111] rounded-2xl rounded-br-sm px-3 py-2">
                        <p className="text-[13px] text-white font-medium leading-snug">{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-[#C4C9D4] mt-0.5 text-right">{fmtTime(msg.ts)}</p>
                    </div>
                  </div>
                )
              }

              return (
                <div key={`${msg.ts}-${i}`}>
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="text-[14px] shrink-0 mt-0.5 select-none" aria-hidden>🐾</span>
                    <div className="flex-1 min-w-0">
                      <div className="inline-block bg-amber-50 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-2 mb-1 max-w-full">
                        <p className="text-[13px] text-[#92400E] font-medium leading-snug">{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-[#C4C9D4] ml-1">{fmtTime(msg.ts)}</p>
                    </div>
                  </div>
                  {msg.items.length > 0 && (
                    <div className="ml-6 flex flex-col gap-1.5">
                      {msg.items.slice(0, 3).map(item => (
                        <ChatMiniCard key={item.id} item={item} onClose={onClose} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
          {/* Scroll anchor — brings latest message into view on open */}
          <div ref={bottomRef} />
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

// ── Intent input bar ──────────────────────────────────────────────────────────
//
// clearSignal: incremented by parent after a successful submit to clear the
// input value. This decouples clearing from intentMode toggling — the input
// is NOT cleared when intentMode flips to false (which was the root cause of
// the input-disappears-on-submit bug).

interface IntentBarProps {
  intentMode:  boolean
  loading:     boolean
  clearSignal: number
  onSubmit:    (query: string) => void
  onClear:     () => void
}

function IntentBar({ intentMode, loading, clearSignal, onSubmit, onClear }: IntentBarProps) {
  const [value, setValue] = useState('')

  // Clear input ONLY when parent explicitly signals success (not on intentMode changes)
  useEffect(() => {
    if (clearSignal > 0) setValue('')
  }, [clearSignal])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (q && !loading) onSubmit(q)
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

// ── Quick filter chips ────────────────────────────────────────────────────────

type Filter = 'all' | 'tonight' | 'food' | 'outdoor' | 'free' | 'student-friendly'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',               label: '🐾 All'              },
  { id: 'tonight',           label: '🌙 Tonight'          },
  { id: 'food',              label: '🍜 Food'             },
  { id: 'outdoor',           label: '🌿 Outdoor'          },
  { id: 'free',              label: '🆓 Free'             },
  { id: 'student-friendly',  label: '🎓 Student-Friendly' },
]

function applyFilter(items: ScoredItem[], filter: Filter): ScoredItem[] {
  if (filter === 'all') return items
  return items.filter(({ item }) => {
    const tags = (item.tags ?? []).map(t => t.toLowerCase())
    switch (filter) {
      case 'tonight': {
        if (!item.start_time) return false
        const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
        return h > 0 && h < 24
      }
      case 'food':             return item.category === 'food'
      case 'outdoor':          return item.category === 'outdoor'
      case 'free':             return tags.includes('free')
      case 'student-friendly': return tags.includes('student-friendly')
    }
  })
}

// ── Card — identical to HomePersonalization ForYouCard ────────────────────────

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

// ── Skeleton — matches ForYouCard exactly ─────────────────────────────────────

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

// ── Top Pick card (featured section) ─────────────────────────────────────────

function TopPickCard({
  item,
  reason,
  onClick,
}: {
  item:     Item
  reason?:  string | null
  onClick?: (item: Item) => void
}) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={() => onClick?.(item)}
      className="group relative w-full bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      <div className={cn('relative h-[190px] w-full shrink-0 overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image src={item.flyer_image_url} alt={item.title} fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="(max-width:640px) 100vw, 75vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl opacity-30 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        <div className="absolute top-3 left-3">
          <span className="text-[10px] font-bold text-white bg-black/70 backdrop-blur-sm rounded-full px-2 py-0.5 uppercase tracking-wide">
            Top Pick
          </span>
        </div>
      </div>
      <div className="flex flex-col p-4 flex-1">
        <h3 className="text-[15px] font-bold text-[#111111] leading-snug line-clamp-2 mb-2 group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>
        {reason && (
          <span className="inline-flex items-center self-start text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5 mb-3">
            🐾 {reason}
          </span>
        )}
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            {loc && (
              <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] truncate">
                <MapPin className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{loc}</span>
              </p>
            )}
            {time ? (
              <p className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" /><span>{time}</span>
              </p>
            ) : (
              <p className="text-[11px] text-[#9CA3AF] capitalize">{cat?.label ?? item.category}</p>
            )}
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-[#111111] bg-[#F3F4F6] group-hover:bg-[#E5E7EB] rounded-full px-3.5 py-1.5 transition-colors whitespace-nowrap">
            View<ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── Backup Pick card (featured section) ──────────────────────────────────────

function BackupPickCard({
  item,
  reason,
  onClick,
}: {
  item:     Item
  reason?:  string | null
  onClick?: (item: Item) => void
}) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      onClick={() => onClick?.(item)}
      className="group bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-row gap-3 p-3"
    >
      <div className={cn('relative w-[72px] h-[72px] shrink-0 rounded-xl overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image src={item.flyer_image_url} alt={item.title} fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="72px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col flex-1 min-w-0 justify-between py-0.5">
        <div>
          <div className="flex items-start justify-between gap-1">
            <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 flex-1 group-hover:text-[#333] transition-colors">
              {item.title}
            </h3>
            <ArrowRight className="w-3 h-3 text-[#C4C9D4] group-hover:text-[#9CA3AF] shrink-0 mt-0.5" />
          </div>
          {reason && <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate">{reason}</p>}
        </div>
        <p className="text-[11px] text-[#9CA3AF] flex items-center gap-1 mt-1.5">
          {time ? (
            <><Clock className="w-2.5 h-2.5 shrink-0" /><span>{time}</span></>
          ) : loc ? (
            <><MapPin className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{loc}</span></>
          ) : (
            <span className="capitalize">{cat?.label ?? item.category}</span>
          )}
        </p>
      </div>
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12

export default function ForYouClient() {
  const { interests, hasInterests, allTags, hydrated: interestsHydrated, dismiss } =
    useInterests()
  const { profile, recordClick } = useTasteProfile()

  const [feed, setFeed]                 = useState<ScoredItem[]>([])
  const [loading, setLoading]           = useState(true)
  const [filter, setFilter]             = useState<Filter>('all')
  const [showModal, setShowModal]       = useState(false)

  // ── Persistent assistant bar ──────────────────────────────────────────────
  const [assistantMsg, setAssistantMsg] = useState('here\'s something good for you 🐾')
  const [chatOpen, setChatOpen]         = useState(false)
  const [chatHistory, setChatHistory]   = useState<ChatMessage[]>([])

  // ── Intent state ──────────────────────────────────────────────────────────
  const [intentMode, setIntentMode]       = useState(false)
  const [intentLoading, setIntentLoading] = useState(false)
  const [intentScored, setIntentScored]   = useState<ScoredItem[]>([])
  // clearSignal: incrementing this tells IntentBar to clear its input value
  const [clearSignal, setClearSignal]     = useState(0)
  // Tracks the last query and its result for stable display / fallback
  const [activeQuery, setActiveQuery]     = useState<string | null>(null)

  // lastSearchTs: timestamp of last user-initiated search.
  // Used to prevent ambient/pet messages from overwriting real search results.
  const lastSearchTsRef = useRef(0)

  // ── Infinite scroll ───────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef                     = useRef<HTMLDivElement>(null)

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

  // On mount: load chat history and restore assistant message from it
  useEffect(() => {
    const history = loadChat()
    setChatHistory(history)
    // Restore the last real assistant message from history
    const lastAssistant = history.find(m => (m.role ?? 'assistant') === 'assistant')
    if (lastAssistant) setAssistantMsg(lastAssistant.text)
  }, [])

  // Bridge: receive pet reaction messages dispatched from PetWidget on any page.
  // GUARD: do not overwrite the bar if a real search happened in the last 5 minutes.
  useEffect(() => {
    function onPetMessage(e: Event) {
      const { text } = (e as CustomEvent<{ text: string }>).detail
      if (!text) return
      const recentSearch = (Date.now() - lastSearchTsRef.current) < 5 * 60_000
      if (recentSearch) return   // preserve active search result
      setAssistantMsg(text)
      setChatHistory(loadChat())
    }
    window.addEventListener('pet:message', onPetMessage)
    return () => window.removeEventListener('pet:message', onPetMessage)
  }, [])

  // On hydration: set taste-aware greeting ONLY if no prior chat message exists
  // and the user hasn't done a real search yet.
  useEffect(() => {
    if (!interestsHydrated) return
    if (loadChat().find(m => (m.role ?? 'assistant') === 'assistant')) return
    if (lastSearchTsRef.current > 0) return

    const hour    = new Date().getHours()
    const summary = tasteSummary(profile)
    if (summary) {
      setAssistantMsg(`you always end up around ${summary} 😌`)
    } else if (hour >= 17) {
      setAssistantMsg('you might like these tonight 👀')
    } else if (hour >= 12) {
      setAssistantMsg('picked some things for you 🎯')
    } else {
      setAssistantMsg("here's what's on today 🌅")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interestsHydrated])

  // Fetch 40 scored items on hydration
  useEffect(() => {
    if (!interestsHydrated) return
    let cancelled = false

    fetchScoredFeed(ctx, allTags, 40)
      .then(items => {
        if (!cancelled) {
          setFeed(items)
          // Derive featured picks using session-seen (skips homepage's top picks)
          const seen    = getSeenIds()
          const { top, backups } = pickTopAndBackups(items, seen)
          // Register featured picks as seen so they don't repeat
          const featIds: string[] = []
          if (top) featIds.push(top.item.id)
          backups.forEach(b => featIds.push(b.item.id))
          markSeen(featIds)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interestsHydrated])

  // IntersectionObserver — load more when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || loading) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount(c => c + PAGE_SIZE) },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  // Keep ctx ref stable for intent handler
  const ctxRef = useRef(ctx)
  useEffect(() => { ctxRef.current = ctx }, [ctx])

  // ── Intent submit ─────────────────────────────────────────────────────────
  //
  // FIX: removed the setIntentMode(false) call at the start of this function.
  //      Previously, flipping intentMode→false triggered IntentBar's useEffect
  //      to clear the input immediately, losing the typed query mid-flight.
  //      Now: intentMode only flips on the success/failure path (at the end),
  //      and input clearing is decoupled via clearSignal.
  //
  // FIX: stores both a 'user' message AND an 'assistant' message in chat history
  //      so the conversation shows what was asked alongside what was answered.
  //
  // FIX: guards ambient overwrite via lastSearchTsRef so greetings / pet events
  //      cannot overwrite the assistant bar after a real search.
  const handleIntentSubmit = useCallback(async (query: string) => {
    setIntentLoading(true)
    setActiveQuery(query)
    lastSearchTsRef.current = Date.now()

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
      const rawItems: Item[] = res.ok ? await res.json() : []

      // ── Strict time range filter (client-side hard gate) ──────────────────
      // The API enforces the range at DB level when time is 'today'/'tomorrow'/
      // 'this-week', but we re-enforce on the client to guard against any leakage
      // (e.g. items without start_time that the API always includes, or edge cases
      // where the param was not understood).
      //
      // Rules:
      //  - Items WITHOUT start_time (food spots, places) are always kept — they
      //    are not time-bound events and should always appear as context.
      //  - Items WITH start_time are hard-filtered to the declared range.
      let timeStart: Date | null = null
      let timeEnd:   Date | null = null
      const nt = new Date()
      if (intent.time === 'today') {
        timeStart = new Date()                // from now (not midnight — no past events)
        timeEnd   = endOfLADay(nt, 0)
      } else if (intent.time === 'tomorrow') {
        timeStart = startOfLADay(nt, 1)
        timeEnd   = endOfLADay(nt, 1)
      } else if (intent.time === 'this-week') {
        timeStart = new Date()
        timeEnd   = endOfLADay(nt, 7)
      }

      // eslint-disable-next-line no-console
      console.log('[intent]', intent.time, timeStart?.toISOString() ?? 'any', timeEnd?.toISOString() ?? 'any')

      const items: Item[] = rawItems.filter(item => {
        if (!item.start_time) return true    // non-event items always pass
        if (!timeStart || !timeEnd) return true  // no time constraint
        const t = new Date(item.start_time).getTime()
        return t >= timeStart.getTime() && t <= timeEnd.getTime()
      })

      // eslint-disable-next-line no-console
      console.log('[filtered count]', items.length, '(from', rawItems.length, 'raw)')

      const scored: ScoredItem[] = items
        .filter(item => !intent.exclusions.includes(item.category))
        .map(item => ({
          item,
          score:  scoreItem(item, currentCtx) + intentBoost(item, intent),
          reason: intentReason(item, intent) ?? reasonFor(item, currentCtx),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)

      const now         = Date.now()
      // If we had a strict time filter but got zero results, use a context-aware fallback
      const noTimeMatch = timeStart !== null && items.length === 0
      const responseText = scored.length > 0
        ? buildIntentResponse(intent, scored.length)
        : noTimeMatch
          ? `Couldn't find a great match for ${intent.time === 'tomorrow' ? 'tomorrow' : intent.time === 'today' ? 'today' : 'that time'} — here are some close ones 🐾`
          : `I couldn't find a great exact match for "${query}" — try these instead 🐾`

      // Store user query + assistant response as a pair in chat history.
      // Newest-first storage: [assistantMsg, userMsg, ...older]
      const userChatMsg: ChatMessage = {
        role:   'user',
        text:   query,
        items:  [],
        ts:     now - 1,   // 1ms before assistant so ordering is stable
        source: 'intent',
      }
      const assistantChatMsg: ChatMessage = {
        role:   'assistant',
        text:   responseText,
        items:  scored.slice(0, 3).map(s => ({
          id:              s.item.id,
          title:           s.item.title,
          category:        s.item.category,
          flyer_image_url: s.item.flyer_image_url,
        })),
        ts:     now,
        source: 'intent',
      }
      appendChat([assistantChatMsg, userChatMsg])
      setChatHistory(loadChat())

      setAssistantMsg(responseText)
      setIntentScored(scored)
      setIntentMode(true)
      // Signal IntentBar to clear its input — happens AFTER results are stable
      setClearSignal(s => s + 1)
    } catch {
      // On error: keep the input value (don't clear it), show a stable fallback
      setAssistantMsg(`Hmm, something went wrong — try again 🐾`)
      setIntentMode(false)
    } finally {
      setIntentLoading(false)
    }
  }, [])

  const handleIntentClear = useCallback(() => {
    setIntentMode(false)
    setIntentScored([])
    setActiveQuery(null)
  }, [])

  // Featured section (top pick + backups) — skips items already seen on the homepage
  const { featuredTop, featuredBackups } = useMemo(() => {
    const seen = getSeenIds()
    const { top, backups } = pickTopAndBackups(feed, seen)
    return { featuredTop: top, featuredBackups: backups }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed])

  // Apply filter + page window — exclude featured items to avoid repetition in grid
  const filtered = useMemo(() => {
    const featIds = new Set([
      featuredTop  ? featuredTop.item.id  : null,
      ...featuredBackups.map(b => b.item.id),
    ].filter(Boolean) as string[])
    return applyFilter(feed, filter).filter(s => !featIds.has(s.item.id))
  }, [feed, filter, featuredTop, featuredBackups])
  const visible  = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore  = visibleCount < filtered.length

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 pt-6 pb-12">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-[22px] font-bold text-[#111111] tracking-tight">
              For You 🔥
            </h1>
            {interestsHydrated && (
              <p className="text-[13px] text-[#6B7280] mt-0.5">
                {dominantCat ? 'based on what you explore' : 'Trending picks for you'}
              </p>
            )}
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors shrink-0 mt-1"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {hasInterests ? 'Edit taste' : 'Set up'}
          </button>
        </div>

        {/* ── Persistent pet assistant bar ─────────────────────────────────── */}
        <PetAssistantBar
          message={assistantMsg}
          onOpenChat={() => setChatOpen(true)}
        />

        {/* ── Intent input ─────────────────────────────────────────────────── */}
        <IntentBar
          intentMode={intentMode}
          loading={intentLoading}
          clearSignal={clearSignal}
          onSubmit={handleIntentSubmit}
          onClear={handleIntentClear}
        />

        {/* ── Featured: Top Pick + Backup Picks ───────────────────────────── */}
        {!intentMode && !loading && featuredTop && (
          <div className="mb-6">
            <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-3">
              Your pick
            </p>
            <div className="flex flex-col gap-3">
              <TopPickCard item={featuredTop.item} reason={featuredTop.reason} onClick={recordClick} />
              {featuredBackups.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {featuredBackups.map(b => (
                    <BackupPickCard key={b.item.id} item={b.item} reason={b.reason} onClick={recordClick} />
                  ))}
                </div>
              )}
            </div>
            {/* Divider before filter chips + grid */}
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-[#F3F4F6]" />
              <span className="text-[11px] font-semibold text-[#C4C9D4] uppercase tracking-wide shrink-0">More picks</span>
              <div className="flex-1 h-px bg-[#F3F4F6]" />
            </div>
          </div>
        )}

        {/* ── Quick filter chips (hidden during intent results) ────────────── */}
        {!intentMode && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5 -mx-6 px-6 mb-6">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => { setFilter(f.id); setVisibleCount(PAGE_SIZE) }}
                className={cn(
                  'flex-none text-[13px] font-medium rounded-full px-3.5 py-1.5 transition-all whitespace-nowrap',
                  filter === f.id
                    ? 'bg-[#111111] text-white'
                    : 'bg-white border border-[#E5E7EB] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Feed ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : intentMode ? (
          intentScored.length === 0 ? (
            /* Empty state: preserve query context, never silently reset */
            <div className="py-8 text-center">
              {activeQuery && (
                <p className="text-[13px] font-medium text-[#374151] mb-1">
                  &ldquo;{activeQuery}&rdquo;
                </p>
              )}
              <p className="text-[13px] text-[#9CA3AF] mb-3">
                No great matches — try different words
              </p>
              <button
                onClick={handleIntentClear}
                className="text-[12px] font-medium text-[#D97706] hover:text-[#B45309] transition-colors"
              >
                ← Back to For You
              </button>
            </div>
          ) : (
            <>
              {/* Active query label — keeps user oriented after submit */}
              {activeQuery && (
                <p className="text-[11px] text-[#9CA3AF] mb-3">
                  Results for <span className="font-semibold text-[#6B7280]">&ldquo;{activeQuery}&rdquo;</span>
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {intentScored.map(({ item, reason }, idx) => (
                  <div key={item.id} onClick={() => recordClick(item)}>
                    <ForYouCard item={item} reason={reason} showBadge={idx < 3} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleIntentClear}
                  className="text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                >
                  ← Back to For You
                </button>
              </div>
            </>
          )
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[14px] text-[#9CA3AF] mb-2">No results for this filter</p>
            <button
              onClick={() => setFilter('all')}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#D97706] hover:text-[#B45309]"
            >
              Show all
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {visible.map(({ item, reason }, idx) => (
                <div key={item.id} onClick={() => recordClick(item)}>
                  <ForYouCard item={item} reason={reason} showBadge={idx < 3} />
                </div>
              ))}
            </div>

            {/* Sentinel for IntersectionObserver — loads next page when visible */}
            <div ref={sentinelRef} className="h-1 mt-4" />

            {/* Fallback "Load more" button for users who prefer explicit interaction */}
            {hasMore && (
              <div className="flex justify-center mt-2">
                <button
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="text-[12px] font-medium text-[#9CA3AF] hover:text-[#374151] transition-colors px-4 py-2"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Personalise nudge — only when no interests set ───────────────── */}
        {interestsHydrated && !hasInterests && !showModal && !intentMode && (
          <div className="mt-8 flex items-center justify-between border border-amber-200 bg-amber-50 rounded-2xl px-5 py-4">
            <div>
              <p className="text-[13px] font-semibold text-[#92400E]">
                Make it more personal
              </p>
              <p className="text-[11px] text-[#A16207] mt-0.5">
                Tell us what you like — we&apos;ll sharpen the picks
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#D97706] hover:text-[#B45309] transition-colors shrink-0 ml-4"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Set up
            </button>
          </div>
        )}

      </main>

      <Footer />

      {showModal && (
        <InterestsOnboarding
          onClose={() => {
            setShowModal(false)
            dismiss()
          }}
        />
      )}

      {chatOpen && (
        <PetChatPanel
          messages={chatHistory}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}
