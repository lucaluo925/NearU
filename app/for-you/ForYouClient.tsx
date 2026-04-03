'use client'

/**
 * /for-you  — dedicated personalized recommendation page.
 *
 * Uses the same scoring logic as the homepage For You section but:
 *   - shows more items (up to 24)
 *   - uses a grid layout (2 → 3 → 4 columns)
 *   - adds quick filter chips (Tonight / Food / Outdoor / Free / Student-Friendly)
 *   - client-side filtering so no extra fetches
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, MapPin, Clock, Settings2, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'

import { useInterests }    from '@/hooks/useInterests'
import { useTasteProfile, getDominantTaste, tasteSummary, topNKeys } from '@/hooks/useTasteProfile'
import {
  buildScoreContext,
  fetchScoredFeed,
  type ScoredItem,
} from '@/lib/recommendations'
import { CATEGORIES } from '@/lib/constants'
import { formatTime, cn } from '@/lib/utils'
import Header  from '@/components/Header'
import Footer  from '@/components/Footer'

const InterestsOnboarding = dynamic(
  () => import('@/components/InterestsOnboarding'),
  { ssr: false },
)

// ── Quick filter chips ────────────────────────────────────────────────────────

type Filter = 'all' | 'tonight' | 'food' | 'outdoor' | 'free' | 'student-friendly'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',              label: '✨ All'              },
  { id: 'tonight',         label: '🌙 Tonight'          },
  { id: 'food',            label: '🍜 Food'             },
  { id: 'outdoor',         label: '🌿 Outdoor'          },
  { id: 'free',            label: '🆓 Free'             },
  { id: 'student-friendly', label: '🎓 Student-Friendly' },
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

// ── Card (grid variant) ───────────────────────────────────────────────────────

const CAT_GRADIENT: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

function GridCard({ item, reason }: { item: ScoredItem['item']; reason: string | null }) {
  const cat      = CATEGORIES.find(c => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group flex flex-col bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Hero image */}
      <div className={cn('relative h-[120px] shrink-0 bg-gradient-to-br', gradient)}>
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
            <span className="text-3xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        {/* "For You" badge */}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] font-medium text-amber-700 bg-white/90 border border-amber-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
            🔥 For You
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col p-3 flex-1">
        <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>

        {/* Why label */}
        {reason && (
          <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate leading-tight">{reason}</p>
        )}

        <div className="flex-1 min-h-[8px]" />

        {loc && (
          <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] truncate">
            <MapPin className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{loc}</span>
          </p>
        )}

        {time ? (
          <p className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] mt-0.5">
            <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
            {time}
          </p>
        ) : (
          <p className="text-[10px] text-[#C4C9D4] capitalize mt-0.5">{item.category}</p>
        )}
      </div>
    </Link>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden animate-pulse">
          <div className="h-[120px] bg-[#F3F4F6]" />
          <div className="p-3 flex flex-col gap-2">
            <div className="h-3 bg-[#F3F4F6] rounded w-3/4" />
            <div className="h-2.5 bg-[#F3F4F6] rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ForYouClient() {
  const { interests, hasInterests, allTags, hydrated: interestsHydrated, save, dismiss } =
    useInterests()
  const { profile, recordClick } = useTasteProfile()

  const [feed, setFeed]         = useState<ScoredItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<Filter>('all')
  const [showModal, setShowModal] = useState(false)

  const dominantCat = getDominantTaste(profile)
  const summary     = tasteSummary(profile)

  // Build score context once from hydrated data
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

  // Fetch on mount — always shows results even for new users
  useEffect(() => {
    if (!interestsHydrated) return
    let cancelled = false

    fetchScoredFeed(ctx, allTags, 24)
      .then(items => { if (!cancelled) setFeed(items) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interestsHydrated])

  // Apply active quick-filter client-side
  const visible = useMemo(() => applyFilter(feed, filter), [feed, filter])

  // Greeting copy
  const greeting = summary
    ? `you always end up around ${summary} 😌`
    : dominantCat
    ? `based on what you explore`
    : 'Trending picks for you'

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 pt-6 pb-12">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="mb-6">
          <Link href="/" className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#374151] transition-colors mb-4">
            <ArrowLeft className="w-3.5 h-3.5" />
            Home
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-bold text-[#111111] tracking-tight">
                For You 🔥
              </h1>
              {interestsHydrated && (
                <p className="text-[13px] text-[#9CA3AF] mt-0.5">
                  {greeting}
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
        </div>

        {/* ── Quick filter chips ───────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5 -mx-6 px-6 mb-6">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
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

        {/* ── Feed ────────────────────────────────────────────────────────── */}
        {loading ? (
          <GridSkeleton />
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[14px] text-[#9CA3AF] mb-2">No results for this filter</p>
            <button
              onClick={() => setFilter('all')}
              className="text-[12px] font-medium text-[#D97706] hover:text-[#B45309]"
            >
              Show all →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {visible.map(({ item, reason }) => (
              <div key={item.id} onClick={() => recordClick(item)}>
                <GridCard item={item} reason={reason} />
              </div>
            ))}
          </div>
        )}

        {/* ── Personalise nudge — subtle, below the feed ──────────────────── */}
        {interestsHydrated && !hasInterests && !showModal && (
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
    </div>
  )
}
