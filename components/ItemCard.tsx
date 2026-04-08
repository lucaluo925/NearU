'use client'

import Image from 'next/image'
import Link from 'next/link'
import { MapPin, Clock, Navigation } from 'lucide-react'
import { track } from '@vercel/analytics'
import { ItemWithDistance } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { formatDateTime, buildGoogleMapsUrl, buildAppleMapsUrl, formatDistance } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { getTagStyle, tagLabel, classifyTag } from '@/lib/tags'
import FavoriteButton from './FavoriteButton'
import MapButtons from './MapButtons'
import RatingBadge from './RatingBadge'
import { useItemBadge } from '@/hooks/useItemBadge'
import { parseTrailMeta, difficultyColor } from '@/lib/trail-utils'
// language-detection intentionally not imported here — language info lives on detail pages only

interface ItemCardProps {
  item: ItemWithDistance
  view?: 'grid' | 'list' | 'map'
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function isToday(dateStr?: string): boolean {
  if (!dateStr) return false
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

function isThisWeek(dateStr?: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  const eow = new Date(now); eow.setDate(eow.getDate() + 7)
  return d >= now && d <= eow
}

function isTonight(dateStr?: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (d.toDateString() !== new Date().toDateString()) return false
  return d.getHours() >= 17
}

function getTimeLabel(start_time?: string): 'tonight' | 'today' | 'tomorrow' | 'this-week' | null {
  if (!start_time) return null
  const d   = new Date(start_time)
  const now = new Date()
  if (d < now) return null
  if (isTonight(start_time)) return 'tonight'
  if (isToday(start_time))   return 'today'
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow'
  if (isThisWeek(start_time)) return 'this-week'
  return null
}

// ── Badge components ──────────────────────────────────────────────────────────

const TIME_BADGE_STYLES: Record<string, string> = {
  'tonight':   'text-violet-700 bg-violet-50 border-violet-200',
  'today':     'text-emerald-700 bg-emerald-50 border-emerald-200',
  'tomorrow':  'text-sky-700 bg-sky-50 border-sky-200',
  'this-week': 'text-blue-700 bg-blue-50 border-blue-200',
}
const TIME_BADGE_LABELS: Record<string, string> = {
  'tonight':   '🌙 Tonight',
  'today':     '📅 Today',
  'tomorrow':  '🌅 Tomorrow',
  'this-week': '🗓 This Week',
}

function TimeBadge({ start_time }: { start_time?: string }) {
  const label = getTimeLabel(start_time)
  if (!label) return null
  return (
    <span className={cn(
      'inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border uppercase tracking-wide whitespace-nowrap',
      TIME_BADGE_STYLES[label],
    )}>
      {TIME_BADGE_LABELS[label]}
    </span>
  )
}

function FreeBadge({ tags }: { tags: string[] }) {
  const isFree = tags.some((t) => t === 'free' || t === 'free-for-students')
  if (!isFree) return null
  return (
    <span className="inline-flex items-center text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 uppercase tracking-wide whitespace-nowrap">
      🆓 Free
    </span>
  )
}

function QualityBadge({ item, badge }: { item: ItemWithDistance; badge: 'trending' | 'popular' | null }) {
  const isTopRated = (item.avg_rating ?? 0) >= 4.2 && (item.review_count ?? 0) >= 2
  const isNearby   = item.distance_miles !== undefined && item.distance_miles <= 0.5
  if (isTopRated) return (
    <span className="inline-flex items-center text-[10px] font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 border border-amber-200 uppercase tracking-wide whitespace-nowrap">
      ⭐ Top Rated
    </span>
  )
  if (isNearby) return (
    <span className="inline-flex items-center text-[10px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 border border-emerald-200 uppercase tracking-wide whitespace-nowrap">
      📍 Nearby
    </span>
  )
  if (badge === 'trending') return (
    <span className="inline-flex items-center text-[10px] font-medium text-orange-700 bg-orange-50 rounded-full px-2 py-0.5 border border-orange-200 uppercase tracking-wide whitespace-nowrap">
      🔥 Trending
    </span>
  )
  if (badge === 'popular') return (
    <span className="inline-flex items-center text-[10px] font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5 border border-red-200 uppercase tracking-wide whitespace-nowrap">
      ❤️ Popular
    </span>
  )
  return null
}

// ── Tag chips ─────────────────────────────────────────────────────────────────

function TagChip({ tag }: { tag: string }) {
  return (
    <span className={cn('text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap', getTagStyle(tag))}>
      {tagLabel(tag)}
    </span>
  )
}

function sortedTags(tags: string[]): string[] {
  const order = { cuisine: 0, price: 1, vibe: 2, other: 3 }
  return [...tags].sort((a, b) => order[classifyTag(a)] - order[classifyTag(b)])
}

// ── Category placeholder ──────────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

function CategoryPlaceholder({ category }: { category: string }) {
  const cat      = CATEGORIES.find((c) => c.slug === category)
  const gradient = CATEGORY_GRADIENTS[category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  return (
    <div className={cn('absolute inset-0 bg-gradient-to-br flex items-center justify-center', gradient)}>
      <span className="text-5xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
    </div>
  )
}

// ── External link label ───────────────────────────────────────────────────────

function externalLabel(item: ItemWithDistance): string {
  // Outdoor item with a real trail/official link (not just Maps)
  if (item.category === 'outdoor' && item.external_link && !item.external_link.includes('maps.google.com')) {
    return '🥾 View Trail'
  }
  if (item.source_type === 'seed-data' || item.external_link?.includes('maps.google.com')) {
    return 'Open in Maps'
  }
  return 'View Details'
}

// ── Location string ───────────────────────────────────────────────────────────

function LocationLine({ item }: { item: ItemWithDistance }) {
  const name     = item.location_name ?? item.address
  const showCity = item.city && item.location_name &&
    !item.location_name.toLowerCase().includes(item.city.toLowerCase())
  return (
    <span className="line-clamp-1 flex-1 min-w-0">
      {name}
      {showCity && <span className="text-[#C4C9D4]"> · {item.city}</span>}
    </span>
  )
}

// ── List card ─────────────────────────────────────────────────────────────────
// List cards sit in a single column so per-row equalization is sufficient.
// Fixed thumbnail (72px), predictable body rows, no conditional content blocks.

function ListCard({ item }: { item: ItemWithDistance }) {
  const detailHref  = `/listing/${item.id}`
  const googleUrl   = buildGoogleMapsUrl(item.address, item.latitude, item.longitude)
  const appleUrl    = buildAppleMapsUrl(item.address, item.latitude, item.longitude)
  const tags        = sortedTags(item.tags ?? []).filter((t) => t !== 'free' && t !== 'free-for-students').slice(0, 2)
  const badge       = useItemBadge(item.id)
  const isEvent     = !!item.start_time
  const dateTimeStr = formatDateTime(item.start_time, item.end_time)

  return (
    <div className="group bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:border-[#D1D5DB] transition-all duration-200 overflow-hidden animate-fade-up">
      <div className="flex gap-0 sm:gap-3">

        {/* Thumbnail — fixed 72×72 */}
        <Link href={detailHref}
          className="relative w-[72px] h-[72px] shrink-0 self-center overflow-hidden rounded-xl my-3 ml-3 bg-[#F3F4F6]">
          {item.flyer_image_url
            ? <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover" sizes="72px" />
            : <CategoryPlaceholder category={item.category} />
          }
        </Link>

        {/* Body */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 py-3 pl-1 pr-3">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <Link href={detailHref} className="flex-1 min-w-0">
              <h3 className="text-[14px] font-semibold text-[#111111] leading-snug line-clamp-1 group-hover:text-[#333] transition-colors">
                {item.title}
              </h3>
            </Link>
            <FavoriteButton id={item.id} category={item.category} className="shrink-0 -mt-0.5" />
          </div>

          {/* Badges row — reserved even when empty */}
          <div className="flex items-center gap-1.5 h-[20px] overflow-hidden">
            {isEvent ? (
              <><TimeBadge start_time={item.start_time} /><FreeBadge tags={item.tags ?? []} /></>
            ) : (
              <><QualityBadge item={item} badge={badge} /><RatingBadge avgRating={item.avg_rating} reviewCount={item.review_count} size="xs" /></>
            )}
          </div>

          {/* Meta row — location + time */}
          <div className="flex items-center gap-2 h-[16px] overflow-hidden">
            <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF] flex-1 min-w-0 overflow-hidden">
              <MapPin className="w-3 h-3 shrink-0" />
              <LocationLine item={item} />
            </span>
            {item.distance_miles !== undefined && (
              <span className="flex items-center gap-0.5 text-[11px] font-medium text-[#6B7280] shrink-0">
                <Navigation className="w-2.5 h-2.5" />
                {formatDistance(item.distance_miles)}
              </span>
            )}
            {dateTimeStr && (
              <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF] shrink-0">
                <Clock className="w-3 h-3" />
                {dateTimeStr}
              </span>
            )}
          </div>

          {/* Tags — fixed 1-row area */}
          <div className="flex gap-1 h-[20px] overflow-hidden">
            {tags.map((tag) => <TagChip key={tag} tag={tag} />)}
          </div>
        </div>

        {/* Action column */}
        <div className="flex flex-col gap-2 shrink-0 items-end justify-center pr-3 py-3">
          {item.external_link && (
            <a href={item.external_link} target="_blank" rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); track('view_item', { title: item.title, category: item.category }) }}
              className="flex items-center justify-center text-[11px] font-semibold bg-[#111111] text-white rounded-xl px-3 py-1.5 hover:bg-[#333] active:scale-[0.97] transition-all whitespace-nowrap">
              {externalLabel(item)}
            </a>
          )}
          <MapButtons googleUrl={googleUrl} appleUrl={appleUrl} size="sm" />
        </div>
      </div>
    </div>
  )
}

// ── Grid card ─────────────────────────────────────────────────────────────────
// All grid cards are structurally identical — no conditional content blocks.
// Fixed image (156px) + fixed-structure body produces uniform heights in grid.
//
//  ┌─────────────────────────┐  ←  156px image (always present)
//  │  [badge]       [♥]      │
//  │                         │
//  └─────────────────────────┘
//  ┌─────────────────────────┐  ←  body (flex-col, p-4)
//  │ Title line 1            │  ←  line-clamp-2, min-height 2 lines
//  │ Title line 2            │
//  │ 📍 Location · City      │  ←  always 1 line
//  │          ↕ flex-1       │  ←  spacer absorbs slack
//  ├─────────────────────────┤  ←  border-t divider
//  │ 🕐 Time  /  ⭐ Rating   │  ←  fixed h-[20px] info row
//  │ [ View Details btn ]    │  ←  fixed h-[32px] CTA
//  └─────────────────────────┘

function GridCard({ item }: { item: ItemWithDistance }) {
  const detailHref  = `/listing/${item.id}`
  const googleUrl   = buildGoogleMapsUrl(item.address, item.latitude, item.longitude)
  const appleUrl    = buildAppleMapsUrl(item.address, item.latitude, item.longitude)
  const isEvent     = !!item.start_time
  const isOutdoor   = item.category === 'outdoor'
  const badge       = useItemBadge(item.id)
  const trailMeta   = isOutdoor ? parseTrailMeta(item.known_for) : null

  return (
    <div className="group bg-white rounded-[22px] border border-[#E5E7EB] shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col animate-fade-up">

      {/* ── Image zone — always 156px ──────────────────── */}
      <Link href={detailHref}
        className="relative h-[156px] shrink-0 block overflow-hidden bg-gradient-to-br from-[#F3F4F6] to-[#E9EAEC]">
        {item.flyer_image_url
          ? <Image src={item.flyer_image_url} alt={item.title} fill
              className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
              sizes="(max-width:640px) 100vw,50vw" />
          : <CategoryPlaceholder category={item.category} />
        }
        {/* Overlay badges — always rendered, height-neutral (absolute) */}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5 max-w-[calc(100%-52px)] overflow-hidden">
          {isEvent
            ? <><TimeBadge start_time={item.start_time} /><FreeBadge tags={item.tags ?? []} /></>
            : <QualityBadge item={item} badge={badge} />
          }
        </div>
        <div className="absolute top-2.5 right-2.5">
          <FavoriteButton id={item.id} category={item.category} />
        </div>
      </Link>

      {/* ── Body ───────────────────────────────────────── */}
      <div className="flex flex-col p-4 flex-1">

        {/* Title — always reserves 2-line height */}
        <Link href={detailHref} className="block mb-2">
          <h3
            className="text-[14px] font-bold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors"
            style={{ minHeight: '2.625em' }}
          >
            {item.title}
          </h3>
        </Link>

        {/* Location — always 1 line */}
        <div className="flex items-center gap-1 text-[12px] text-[#9CA3AF] h-[1.25rem] overflow-hidden">
          <MapPin className="w-3 h-3 shrink-0" />
          <LocationLine item={item} />
        </div>

        {/* Flex spacer — pushes footer to bottom */}
        <div className="flex-1 min-h-[8px]" />

        {/* Footer ───────────────────────────────────── */}
        <div className="pt-3 border-t border-[#F3F4F6]">

          {/* Info row — fixed h-[20px], always occupies space */}
          <div className="flex items-center gap-1.5 h-[20px] overflow-hidden mb-2.5">
            {isEvent ? (
              <>
                {item.start_time && (
                  <span className="flex items-center gap-1 text-[11px] text-[#6B7280] line-clamp-1 flex-1 min-w-0 overflow-hidden">
                    <Clock className="w-3 h-3 shrink-0 text-[#9CA3AF]" />
                    {formatDateTime(item.start_time, item.end_time)}
                  </span>
                )}
              </>
            ) : isOutdoor && trailMeta ? (
              <div className="flex items-center gap-1.5 overflow-hidden">
                {trailMeta.difficulty && (
                  <span className={cn('text-[10px] font-bold rounded-full px-2 py-0.5 border shrink-0', difficultyColor(trailMeta.difficulty))}>
                    {trailMeta.difficulty}
                  </span>
                )}
                {trailMeta.length && (
                  <span className="text-[11px] text-[#6B7280] truncate">{trailMeta.length}</span>
                )}
                {trailMeta.type && (
                  <span className="text-[11px] text-[#9CA3AF] truncate">· {trailMeta.type}</span>
                )}
              </div>
            ) : (
              <RatingBadge avgRating={item.avg_rating} reviewCount={item.review_count} size="xs" />
            )}
          </div>

          {/* CTA */}
          {item.external_link ? (
            <a href={item.external_link} target="_blank" rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); track('view_item', { title: item.title, category: item.category }) }}
              className="flex items-center justify-center gap-1.5 w-full text-[12px] font-semibold bg-[#111111] text-white rounded-xl py-2 hover:bg-[#333] active:scale-[0.98] transition-all duration-150">
              {externalLabel(item)}
            </a>
          ) : (
            <Link href={detailHref}
              className="flex items-center justify-center gap-1.5 w-full text-[12px] font-semibold bg-[#111111] text-white rounded-xl py-2 hover:bg-[#333] active:scale-[0.98] transition-all duration-150">
              View Details
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function ItemCard({ item, view: viewProp = 'grid' }: ItemCardProps) {
  const view = viewProp === 'map' ? 'grid' : viewProp
  return view === 'list' ? <ListCard item={item} /> : <GridCard item={item} />
}
