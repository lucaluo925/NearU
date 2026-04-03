'use client'

/**
 * HomePersonalization
 *
 * "For You 🔥" feed — personalized, pet-guided, intent-aware.
 *
 * Architecture
 * ────────────
 * 1. useInterests    — explicit user preferences (saved tags / categories)
 * 2. useTasteProfile — implicit behavior profile (click counts per category / tag)
 * 3. ScoreContext    — merged view of both; snapshotted once per session
 * 4. scoreItem()     — deterministic multi-signal scorer (no ML)
 * 5. reasonFor()     — "why this is for you" label from winning signal
 * 6. parseIntent()   — rule-based NL parser → structured filters
 * 7. intentBoost()   — extra score bonus for intent-matched items
 * 8. AssistantActions — quick-action pills, reordered by dominant taste
 * 9. IntentBar       — compact free-text assistant input
 * 10. PetWhisper     — taste-aware / intent-aware amber bubble
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Settings2, MapPin, Clock, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'

import { useInterests }    from '@/hooks/useInterests'
import { useTasteProfile, getDominantTaste, tasteSummary, topNKeys } from '@/hooks/useTasteProfile'
import { parseIntent, buildIntentResponse, type ParsedIntent } from '@/lib/intent-parser'
import {
  buildScoreContext,
  scoreItem,
  reasonFor,
  fetchScoredFeed,
  type ScoreContext,
  type ScoredItem,
} from '@/lib/recommendations'
import { Item, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { formatTime, cn } from '@/lib/utils'

const InterestsOnboarding = dynamic(
  () => import('@/components/InterestsOnboarding'),
  { ssr: false },
)

// ScoreContext, buildScoreContext, scoreItem, reasonFor, ScoredItem
// are all imported from @/lib/recommendations (shared with /for-you page).

// ── Intent scoring helpers ────────────────────────────────────────────────────
//
// Applied on top of base scoreItem() when the user has expressed explicit intent.

/** Extra score boost for items that match the parsed intent. */
function intentBoost(item: Item, intent: ParsedIntent): number {
  let boost = 0
  const itemTags = (item.tags ?? []).map(t => t.toLowerCase())

  // Strong match: user explicitly named this category
  if (intent.categories.includes(item.category))                     boost += 5

  // Each intent-derived tag match (from vibe expansion or explicit tag)
  boost += itemTags.filter(t => intent.tags.includes(t)).length * 3

  // Tonight boost: items happening soon get extra priority
  if (intent.time === 'today' && item.start_time) {
    const h = (new Date(item.start_time).getTime() - Date.now()) / 3_600_000
    if (h > 0 && h < 24) boost += 4
  }

  return boost
}

/** Per-card "why" label when showing intent results. */
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
  }

  if (intent.region === 'on-campus') return 'Near campus'

  if (intent.categories.includes(item.category)) return 'Matches what you asked'

  return null
}

// ── Pet messages ──────────────────────────────────────────────────────────────
//
// Taste-aware: if we know the user's dominant category, reference it.
// Low-frequency: only fires at mount + every 4th scroll-into-view.

const TASTE_MSGS: Record<string, string[]> = {
  food:     [
    'you always end up around food spots 😌',
    'another food spot — because of course 🍜',
    'your stomach guided me here 🐾',
  ],
  events:   [
    "you've been in an event mood lately 🎉",
    'found one more event I think you\'d like',
    'your calendar is filling up 😄',
  ],
  outdoor:  [
    'you keep drifting toward outdoor places 🌿',
    'fresh air vibes, as usual 🐾',
    'outside again? love it',
  ],
  study:    [
    'study mode: engaged ☕',
    'found another good focus spot',
    'keeping your study game strong 📚',
  ],
  shopping: [
    'found something worth browsing 🛍️',
    'your shopping radar is on',
  ],
  campus:   [
    'staying close to campus 🎓',
    'on-campus energy today',
  ],
}

const GENERIC_MSGS = [
  "this feels like your kind of thing 👀",
  "I thought you'd like this 🐾",
  "ooh, this one's for you 🎯",
  "bet you'd enjoy this 🌟",
  "this one caught my eye for you 🐾",
]

function getPetMsg(
  trigger:    'mount' | 'scroll',
  dominantCat: string | null,
  item?:      Item,
): string {
  if (trigger === 'mount') {
    if (dominantCat && TASTE_MSGS[dominantCat])
      return TASTE_MSGS[dominantCat][0]
    return "I thought you'd like these 🐾"
  }
  // scroll: comment on the specific item's category if it matches
  const cat = item?.category
  if (cat && TASTE_MSGS[cat]) {
    const pool = TASTE_MSGS[cat]
    return pool[Math.floor(Math.random() * pool.length)]
  }
  return GENERIC_MSGS[Math.floor(Math.random() * GENERIC_MSGS.length)]
}

function firePet(message: string, type: 'bounce' | 'celebrate' | 'excited' = 'excited') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('pet:react', { detail: { type, message, context: 'for-you' } }),
  )
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

// ── Pet whisper bubble ────────────────────────────────────────────────────────

function PetWhisper({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-2 mb-3 animate-fade-up">
      <span className="text-[18px] select-none" aria-hidden>🐾</span>
      <div className="bg-[#FEF9C3] border border-amber-200 rounded-xl px-3 py-1.5 shadow-sm">
        <p className="text-[12px] text-[#92400E] font-medium leading-snug">{msg}</p>
      </div>
    </div>
  )
}

// ── Assistant quick actions ───────────────────────────────────────────────────
//
// Four pre-baked links that reuse existing filters.
// The action matching the user's dominant taste floats to the front.

interface AssistantAction { label: string; href: string; cat?: string }

const ACTIONS: AssistantAction[] = [
  { label: '🌙 Tonight',     href: '/search?category=events&time=today', cat: 'events'  },
  { label: '🍜 Food spots',  href: '/food',                              cat: 'food'    },
  { label: '🌿 Chill spots', href: '/search?tag=outdoor&sort=top-rated', cat: 'outdoor' },
  { label: '📍 Near campus', href: '/search?region=on-campus'                           },
]

function AssistantActions({ dominantCat }: { dominantCat: string | null }) {
  const sorted = useMemo(() => {
    if (!dominantCat) return ACTIONS
    return [
      ...ACTIONS.filter(a => a.cat === dominantCat),
      ...ACTIONS.filter(a => a.cat !== dominantCat),
    ]
  }, [dominantCat])

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5 -mx-6 px-6 mb-4">
      {sorted.map(a => (
        <Link
          key={a.href}
          href={a.href}
          className="flex-none text-[12px] font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-full px-3 py-1 hover:border-[#D1D5DB] hover:bg-[#F9FAFB] hover:shadow-sm transition-all whitespace-nowrap"
        >
          {a.label}
        </Link>
      ))}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  item:         Item
  reason?:      string | null
  showBadge?:   boolean
  highlighted?: boolean
  onVisible?:   () => void
  onClick?:     (item: Item) => void
}

function ForYouCard({ item, reason, showBadge, highlighted, onVisible, onClick }: CardProps) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''
  const linkRef  = useRef<HTMLAnchorElement>(null)
  const cbRef    = useRef(onVisible)
  useEffect(() => { cbRef.current = onVisible }, [onVisible])

  // Single IntersectionObserver per card — fires once when 60 % visible
  useEffect(() => {
    const el = linkRef.current
    if (!el || !cbRef.current) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) cbRef.current?.() },
      { threshold: 0.6 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, []) // stable mount-only

  return (
    <Link
      ref={linkRef}
      href={`/listing/${item.id}`}
      onClick={() => onClick?.(item)}
      className={cn(
        'group flex-none overflow-hidden flex flex-col',
        'w-[76vw] max-w-[260px] sm:w-[220px]',
        'h-[244px] bg-white rounded-2xl border shadow-sm',
        'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
        highlighted
          ? 'border-amber-300 ring-2 ring-amber-200/60 shadow-amber-100'
          : 'border-[#E5E7EB]',
      )}
    >
      {/* Image / gradient hero */}
      <div className={cn('relative h-[120px] shrink-0 bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="(max-width:640px) 76vw, 220px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        {showBadge && (
          <div className="absolute top-2 left-2">
            <span className="text-[9px] font-medium text-amber-700 bg-white/90 border border-amber-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
              🔥 For You
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col p-3 flex-1 overflow-hidden">
        <h3
          className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors"
          style={{ minHeight: '2.4em' }}
        >
          {item.title}
        </h3>

        {/* Why-this-is-for-you label */}
        {reason ? (
          <p className="text-[10px] text-[#9CA3AF] mt-0.5 leading-tight truncate">
            {reason}
          </p>
        ) : (
          <div className="h-[14px]" />
        )}

        <div className="flex-1" />

        <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] h-[16px] overflow-hidden">
          {loc && <MapPin className="w-2.5 h-2.5 shrink-0" />}
          <span className="line-clamp-1">{loc}</span>
        </p>

        <div className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] h-[18px] mt-0.5 overflow-hidden">
          {time ? (
            <>
              <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
              <span>{time}</span>
            </>
          ) : (
            <span className="text-[#C4C9D4] capitalize">{item.category}</span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex-none w-[76vw] max-w-[260px] sm:w-[220px] h-[244px] bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden animate-pulse">
      <div className="h-[120px] bg-[#F3F4F6]" />
      <div className="p-3 flex flex-col gap-2 mt-1">
        <div className="h-3 bg-[#F3F4F6] rounded w-3/4" />
        <div className="h-2.5 bg-[#F3F4F6] rounded w-1/2" />
      </div>
    </div>
  )
}

// ScoredItem is imported from @/lib/recommendations

// ── Feed section ──────────────────────────────────────────────────────────────

interface FeedProps {
  savedTags:   string[]
  savedCats:   string[]
  /** Session-snapshotted context — passed once, not reactive */
  ctx:         ScoreContext
  onPetMsg:    (msg: string) => void
  recordClick: (item: Item) => void
  dominantCat: string | null
}

function ForYouSection({
  savedTags,
  savedCats,
  ctx,
  onPetMsg,
  recordClick,
  dominantCat,
}: FeedProps) {
  const [scored, setScored]             = useState<ScoredItem[]>([])
  const [loading, setLoading]           = useState(true)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Stable refs so callbacks don't need to be in effect deps
  const onPetRef     = useRef(onPetMsg)
  const dominantRef  = useRef(dominantCat)
  const seenIds      = useRef(new Set<string>())
  const cardsSeen    = useRef(0)
  useEffect(() => { onPetRef.current    = onPetMsg    }, [onPetMsg])
  useEffect(() => { dominantRef.current = dominantCat }, [dominantCat])

  // ── Fetch + score (runs once per session on mount) ────────────────────────
  // Uses fetchScoredFeed() from @/lib/recommendations.
  // Always fetches — falls back to recents when savedTags is empty so the
  // section always shows real cards even for brand-new users.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await fetchScoredFeed(ctx, savedTags, 16)
        if (!cancelled) setScored(result)
      } catch {
        // silent — a network blip should not break the homepage
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTags.join(','), savedCats.join(',')])

  // ── Pet trigger on card scroll-into-view ─────────────────────────────────
  const handleCardVisible = useCallback((item: Item) => {
    if (seenIds.current.has(item.id)) return
    seenIds.current.add(item.id)
    cardsSeen.current++

    // Fire pet every 4th new card — low frequency, non-spammy
    if (cardsSeen.current % 4 === 0) {
      const msg = getPetMsg('scroll', dominantRef.current, item)
      onPetRef.current(msg)
      firePet(msg, 'excited')
      setHighlightedId(item.id)
      setTimeout(() => setHighlightedId(null), 2_500)
    }
  }, []) // stable — all live values accessed via refs

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-hide">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  if (scored.length === 0) return null

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-3 -mx-6 px-6 scrollbar-hide"
      style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
    >
      {scored.map(({ item, reason }, idx) => (
        <div key={item.id} style={{ scrollSnapAlign: 'start' }}>
          <ForYouCard
            item={item}
            reason={reason}
            showBadge={idx < 3}
            highlighted={highlightedId === item.id}
            onVisible={() => handleCardVisible(item)}
            onClick={recordClick}
          />
        </div>
      ))}
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

  // Clear local input when intent mode is dismissed from outside
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
              {loading ? '…' : '→'}
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
        <p className="text-[13px] text-[#9CA3AF] mb-3">
          No great matches — try different words
        </p>
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
      <div
        className="flex gap-3 overflow-x-auto pb-3 -mx-6 px-6 scrollbar-hide"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {scored.map(({ item, reason }, idx) => (
          <div key={item.id} style={{ scrollSnapAlign: 'start' }}>
            <ForYouCard
              item={item}
              reason={reason}
              showBadge={idx < 3}
              onClick={recordClick}
            />
          </div>
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

  const [showModal, setShowModal]   = useState(false)
  const [showForYou, setShowForYou] = useState(false)
  const [petMsg, setPetMsg]         = useState<string | null>(null)
  const petTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const greetedRef  = useRef(false)

  // ── Intent state ──────────────────────────────────────────────────────────
  const [intentMode, setIntentMode]       = useState(false)
  const [intentLoading, setIntentLoading] = useState(false)
  const [intentScored, setIntentScored]   = useState<ScoredItem[]>([])

  // Derived from both explicit interests and implicit behaviour profile
  const dominantCat = getDominantTaste(profile)

  // ScoreContext is memoized so ForYouSection doesn't re-run its effect
  // when unrelated state changes.  Deps stringify only the data that matters.
  const ctx = useMemo(
    () => buildScoreContext(interests, profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      allTags.join(','),
      interests.categories.join(','),
      // Only rebuild on meaningful profile changes (not on every tiny click)
      topNKeys(profile.categoryCounts, 3).join(','),
      topNKeys(profile.tagCounts, 10).join(','),
    ],
  )

  // Show onboarding modal on first visit; mark section ready on hydration
  useEffect(() => {
    if (!interestsHydrated) return
    if (shouldShowOnboarding) setShowModal(true)
    setShowForYou(true)  // always show the section once hydrated
  }, [interestsHydrated, shouldShowOnboarding])

  // Taste-aware greeting — fires 1.2 s after hydration, once per session
  useEffect(() => {
    if (!showForYou || greetedRef.current) return
    greetedRef.current = true
    const summary = tasteSummary(profile)
    const msg = summary
      ? `you always end up around ${summary} 😌`
      : getPetMsg('mount', dominantCat)
    const t = setTimeout(() => {
      showMsg(msg)
      firePet(msg, 'bounce')
    }, 1_200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForYou])

  const showMsg = useCallback((msg: string, persist = false) => {
    setPetMsg(msg)
    if (petTimerRef.current) clearTimeout(petTimerRef.current)
    if (!persist) {
      petTimerRef.current = setTimeout(() => setPetMsg(null), 4_000)
    }
  }, [])

  useEffect(() => () => {
    if (petTimerRef.current) clearTimeout(petTimerRef.current)
  }, [])

  // Stable ref to ctx so the intent handler doesn't need ctx in its dep array
  const ctxRef = useRef(ctx)
  useEffect(() => { ctxRef.current = ctx }, [ctx])

  // ── Intent submit handler ─────────────────────────────────────────────────
  const handleIntentSubmit = useCallback(async (query: string) => {
    setIntentLoading(true)
    setIntentMode(false)

    try {
      const intent = parseIntent(query)
      const currentCtx = ctxRef.current

      // Build API params from intent signals
      const params = new URLSearchParams({ limit: '60', sort: 'recent' })
      if (intent.categories.length === 1) params.set('category', intent.categories[0])
      if (intent.time)                    params.set('time', intent.time)
      if (intent.budget === 'free')       params.append('tag', 'free')
      if (intent.region === 'on-campus' || intent.region === 'davis') {
        params.set('lat', String(UC_DAVIS_LAT))
        params.set('lng', String(UC_DAVIS_LNG))
        params.set('radius', intent.region === 'on-campus' ? '1' : '5')
      }

      const res          = await fetch(`/api/items?${params}`)
      const items: Item[] = res.ok ? await res.json() : []

      // Score: base signals + intent boost; filter exclusions
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
      setIntentScored(scored)
      showMsg(msg, true)  // persist until user clears
      setIntentMode(true)
      firePet(msg, 'excited')
    } catch {
      // silent
    } finally {
      setIntentLoading(false)
    }
  }, [showMsg])

  const handleIntentClear = useCallback(() => {
    setIntentMode(false)
    setIntentScored([])
    setPetMsg(null)
    if (petTimerRef.current) clearTimeout(petTimerRef.current)
  }, [])

  return (
    <>
      {/* ── For You 🔥 — always shown once hydrated ─────────────────────────── */}
      {showForYou && (
        <section className="mb-10 animate-fade-up">
          {/* Header row: title + "See all" + "Edit" */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-[15px] font-bold text-[#111111] leading-none">For You 🔥</h2>
              <Link
                href="/for-you"
                className="text-[12px] font-medium text-[#9CA3AF] hover:text-[#374151] transition-colors"
              >
                See all →
              </Link>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {hasInterests ? 'Edit' : 'Set up'}
            </button>
          </div>

          {/* Pet whisper — taste-aware, low-frequency */}
          <PetWhisper msg={petMsg} />

          {/* Assistant quick actions */}
          <AssistantActions dominantCat={dominantCat} />

          {/* Intent input bar */}
          <IntentBar
            intentMode={intentMode}
            loading={intentLoading}
            onSubmit={handleIntentSubmit}
            onClear={handleIntentClear}
          />

          {/* Results: intent mode replaces the default For You feed */}
          {intentMode ? (
            <IntentResults
              scored={intentScored}
              onClear={handleIntentClear}
              recordClick={recordClick}
            />
          ) : (
            <ForYouSection
              savedTags={allTags}
              savedCats={interests.categories}
              ctx={ctx}
              onPetMsg={showMsg}
              recordClick={recordClick}
              dominantCat={dominantCat}
            />
          )}

          {/* Subtle personalise nudge — only if no interests set yet */}
          {!hasInterests && !showModal && (
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
      )}

      {/* ── Interests modal ───────────────────────────────────────────────────── */}
      {showModal && (
        <InterestsOnboarding
          onClose={() => {
            setShowModal(false)
            dismiss()
            setShowForYou(true)
          }}
        />
      )}
    </>
  )
}
