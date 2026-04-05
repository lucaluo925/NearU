import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, MapPin, Clock, Map, ExternalLink, UtensilsCrossed, Calendar } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { formatDateTime, formatDate, formatTime, buildGoogleMapsUrl, buildAppleMapsUrl, cleanDescription, DAVIS_TZ } from '@/lib/utils'
import { getCategoryBySlug, getSubcategoryLabel } from '@/lib/constants'
import { getTagStyle, tagLabel, classifyTag, knownForFromTags } from '@/lib/tags'
import { cn } from '@/lib/utils'
import FavoriteButton from '@/components/FavoriteButton'
import MapButtons from '@/components/MapButtons'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import ViewTracker from '@/components/ViewTracker'
import ReviewSection from '@/components/ReviewSection'
import RatingBadge from '@/components/RatingBadge'
import SimilarEvents from '@/components/SimilarEvents'
import CalendarButton from '@/components/CalendarButton'
import NearbyTrails from '@/components/NearbyTrails'
import { Item } from '@/lib/types'
import { isTableMissing } from '@/lib/db-errors'
import { parseTrailMeta, difficultyColor, hasTrailMeta } from '@/lib/trail-utils'
import { detectLanguages, formatLanguageDisplay } from '@/lib/language-detection'

interface Props {
  params: Promise<{ id: string }>
}

async function getItem(id: string): Promise<Item | null> {
  try {
    const supabase = getServerSupabase()
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single()
    if (error || !data) return null
    return data as Item
  } catch {
    return null
  }
}

async function getItemRating(itemId: string): Promise<{ avg_rating: number | null; review_count: number }> {
  try {
    const supabase = getServerSupabase()
    const { data, error } = await supabase
      .from('reviews')
      .select('rating')
      .eq('item_id', itemId)
    if (error || !data) return { avg_rating: null, review_count: 0 }
    if (data.length === 0) return { avg_rating: null, review_count: 0 }
    const avg = Math.round((data.reduce((s, r) => s + (r.rating as number), 0) / data.length) * 10) / 10
    return { avg_rating: avg, review_count: data.length }
  } catch (e: unknown) {
    if (isTableMissing(e as { code?: string; message?: string })) return { avg_rating: null, review_count: 0 }
    return { avg_rating: null, review_count: 0 }
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const item = await getItem(id)
  if (!item) return {}
  return {
    title: `${item.title} — NearU`,
    description: item.description ?? `${item.location_name ?? item.address} · NearU`,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Category-based gradient colours for fallback heroes */
const HERO_GRADIENTS: Record<string, string> = {
  events:   'from-rose-100 via-pink-50 to-pink-100',
  food:     'from-orange-100 via-amber-50 to-yellow-50',
  outdoor:  'from-emerald-100 via-green-50 to-teal-100',
  study:    'from-blue-100 via-indigo-50 to-sky-50',
  shopping: 'from-purple-100 via-pink-50 to-fuchsia-100',
  campus:   'from-yellow-100 via-amber-50 to-orange-100',
}

/**
 * FallbackHero — shown when an item has no flyer image.
 * Feels intentional: category gradient + large icon + truncated title.
 */
function FallbackHero({ category, title }: { category: string; title: string }) {
  const cat      = getCategoryBySlug(category)
  const gradient = HERO_GRADIENTS[category] ?? 'from-[#F3F4F6] via-[#EAECF0] to-[#E5E7EB]'
  return (
    <div className={cn('absolute inset-0 bg-gradient-to-br flex flex-col items-center justify-center gap-3 px-8 text-center', gradient)}>
      <span className="text-6xl opacity-50 select-none">{cat?.icon ?? '📌'}</span>
      <p className="text-[15px] font-semibold text-[#374151] line-clamp-2 max-w-[340px] leading-snug">{title}</p>
    </div>
  )
}

/**
 * getEventDateParts — single source of truth for ALL date display in EventDateBanner.
 *
 * Why two previous attempts failed on Node.js SSR:
 *
 *  Attempt 1 — toLocaleDateString with single-field options:
 *    d.toLocaleDateString('en-US', { weekday: 'long', timeZone: DAVIS_TZ })
 *    Node.js ICU silently ignores timeZone for single-field calls → returns UTC value.
 *
 *  Attempt 2 — Intl.DateTimeFormat.formatToParts() with timeZone:
 *    new Intl.DateTimeFormat('en-US', { timeZone: DAVIS_TZ, ... }).formatToParts(d)
 *    Also unreliable on this Node.js build — returns weekday from UTC,
 *    day/month from LA timezone → parts still mixed.
 *
 * The ONLY proven-reliable call in this environment is:
 *    new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ }).format(d)
 *    → "YYYY-MM-DD" (ISO date string in LA timezone)
 * This exact pattern is used in lib/utils.ts for startOfLADay/endOfLADay
 * and is confirmed to produce correct LA calendar dates.
 *
 * Strategy:
 *  1. Extract the LA calendar date as "YYYY-MM-DD" via en-CA + DAVIS_TZ.
 *  2. Parse year/month/day from the string.
 *  3. Reconstruct a UTC Date at noon on that LA calendar day
 *     (noon avoids any DST edge-case where midnight itself is ambiguous).
 *  4. Format that UTC Date with timeZone:'UTC' — zero timezone conversion,
 *     trivially correct, immune to Node.js ICU timezone quirks.
 */
function getEventDateParts(start_time: string) {
  const d = new Date(start_time)

  // Step 1 — get the LA calendar date string "YYYY-MM-DD"
  const laDateISO = new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ }).format(d)
  // e.g. "2025-04-06" for an event stored as 2025-04-07T03:00:00Z (8 PM PDT Apr 6)

  // Step 2 — parse numeric year / month (1-based) / day
  const [y, mo, dy] = laDateISO.split('-').map(Number)

  // Step 3 — create a fresh UTC Date at noon on that LA calendar day.
  // Noon UTC means this Date is always unambiguously on the correct calendar day
  // regardless of DST boundaries or UTC offset.
  const noonUTC = new Date(Date.UTC(y, mo - 1, dy, 12, 0, 0))

  // Step 4 — format with timeZone:'UTC' so no conversion happens.
  // The calendar date is already correct (came from LA TZ in step 1);
  // we just need the locale's formatting of it.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday:  'long',
    month:    'short',
    day:      'numeric',
  })
  const byType = Object.fromEntries(
    dtf.formatToParts(noonUTC).map(p => [p.type, p.value])
  ) as Record<string, string>
  // byType guaranteed: { weekday: 'Monday', month: 'Apr', day: '6', literal: ... }
  // All parts describe the same LA calendar day — no mixing possible.

  return {
    weekdayShort: byType.weekday.slice(0, 3).toUpperCase(), // 'MON'
    weekdayLong:  byType.weekday,                           // 'Monday'
    day:          byType.day,                               // '6'
    monthShort:   byType.month.toUpperCase(),               // 'APR'
    fullLabel:    `${byType.weekday}, ${byType.month} ${byType.day}`, // 'Monday, Apr 6'
  }
}

/** Prominent event date/time banner — shown above the fold for events */
function EventDateBanner({ start_time, end_time }: { start_time: string; end_time?: string }) {
  // All date display derived from one call to getEventDateParts — badge and
  // text are guaranteed to show the same calendar day in America/Los_Angeles.
  const parts     = getEventDateParts(start_time)
  const startTime = formatTime(start_time)
  const endTime   = end_time ? formatTime(end_time) : null

  return (
    <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl px-5 py-4 mb-5 animate-fade-up animate-fade-up-delay-1">
      {/* Left badge — weekdayShort / day / monthShort all from the same parts object */}
      <div className="w-12 h-12 rounded-xl bg-white border border-blue-100 flex flex-col items-center justify-center shrink-0 shadow-sm">
        <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider leading-none">
          {parts.weekdayShort}
        </span>
        <span className="text-[20px] font-black text-[#111111] leading-tight">
          {parts.day}
        </span>
        <span className="text-[9px] font-medium text-[#6B7280] leading-none">
          {parts.monthShort}
        </span>
      </div>
      {/* Main text — fullLabel built from the same byType parts */}
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-[#111111]">{parts.fullLabel}</p>
        <p className="text-[14px] text-[#6B7280] mt-0.5">
          {startTime}{endTime ? ` – ${endTime}` : ''}
        </p>
      </div>
      <Calendar className="w-5 h-5 text-blue-300 shrink-0" />
    </div>
  )
}

/** OSM map embed — no API key needed */
function MapPreview({ lat, lng, address }: { lat: number; lng: number; address: string }) {
  const delta  = 0.008
  const bbox   = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
  const fullUrl  = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`

  return (
    <div className="rounded-2xl overflow-hidden border border-[#E5E7EB] mb-6 animate-fade-up animate-fade-up-delay-2">
      <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="block relative">
        <iframe
          src={embedUrl}
          width="100%"
          height="180"
          className="block border-0 pointer-events-none"
          title={`Map showing ${address}`}
          loading="lazy"
        />
        {/* Tap overlay — makes the whole tile a link on mobile */}
        <div className="absolute inset-0 bg-transparent" aria-hidden />
      </a>
      <div className="px-4 py-2.5 bg-white border-t border-[#F3F4F6] flex items-center justify-between">
        <p className="text-[12px] text-[#6B7280] line-clamp-1 flex-1 min-w-0">{address}</p>
        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-[#374151] hover:text-[#111111] transition-colors ml-3 shrink-0"
        >
          Open map ↗
        </a>
      </div>
    </div>
  )
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className={cn('text-[12px] font-medium rounded-full px-2.5 py-1', getTagStyle(tag))}>
      {tagLabel(tag)}
    </span>
  )
}

function TagSection({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  const cuisine = tags.filter((t) => classifyTag(t) === 'cuisine')
  const price   = tags.filter((t) => classifyTag(t) === 'price')
  const vibe    = tags.filter((t) => classifyTag(t) === 'vibe')
  const other   = tags.filter((t) => classifyTag(t) === 'other')
  return (
    <div className="flex flex-wrap gap-1.5">
      {cuisine.map((t) => <TagChip key={t} tag={t} />)}
      {price.map((t)   => <TagChip key={t} tag={t} />)}
      {vibe.map((t)    => <TagChip key={t} tag={t} />)}
      {other.map((t)   => <TagChip key={t} tag={t} />)}
    </div>
  )
}

/** True when the external_link is just a Google Maps URL (duplicates MapButtons) */
function isGoogleMapsLink(item: Item): boolean {
  return !!(item.external_link?.includes('maps.google.com') || item.source_type === 'seed-data')
}

function externalButtonLabel(item: Item): string {
  if (isGoogleMapsLink(item)) return 'Open in Google Maps'
  return 'View Details'
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Items that are "low detail" — no description and no flyer
function isLowDetail(item: Item): boolean {
  return !item.description && !item.flyer_image_url
}

// ── Trail components ──────────────────────────────────────────────────────────

function TrailFactBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 py-2 min-w-[70px] text-center">
      <span className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide leading-none">{label}</span>
      <span className="text-[13px] font-bold text-[#111111] leading-tight mt-0.5">{value}</span>
    </div>
  )
}

function TrailFacts({ item }: { item: Item }) {
  const meta   = parseTrailMeta(item.known_for)
  const tags   = item.tags ?? []
  const dogOk  = tags.some((t) => /dog/i.test(t))
  const bikeOk = tags.some((t) => /bike|cycl/i.test(t))

  const hasMeta = meta.difficulty || meta.length || meta.type || meta.elevation || meta.duration
  if (!hasMeta && !dogOk && !bikeOk) return null

  return (
    <div className="mb-6 animate-fade-up animate-fade-up-delay-1">
      <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest mb-3">Trail Facts</p>
      <div className="flex flex-wrap gap-2">
        {meta.difficulty && (
          <span className={cn('inline-flex items-center text-[12px] font-bold rounded-full px-3 py-1 border', difficultyColor(meta.difficulty))}>
            {meta.difficulty}
          </span>
        )}
        {meta.length && <TrailFactBadge label="Length" value={meta.length} />}
        {meta.elevation && meta.elevation !== 'Flat' && <TrailFactBadge label="Elevation" value={meta.elevation} />}
        {meta.type && <TrailFactBadge label="Type" value={meta.type} />}
        {meta.duration && <TrailFactBadge label="Duration" value={meta.duration} />}
        {dogOk && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
            🐕 Dog Friendly
          </span>
        )}
        {bikeOk && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-3 py-1">
            🚲 Bike Friendly
          </span>
        )}
      </div>
    </div>
  )
}

function TrailHighlights({ item }: { item: Item }) {
  const tags = item.tags ?? []
  const highlights: string[] = []
  if (tags.some((t) => /bird/i.test(t))) highlights.push('Birdwatching')
  if (tags.some((t) => /scenic|view/i.test(t))) highlights.push('Scenic views')
  if (tags.some((t) => /swim/i.test(t))) highlights.push('Swimming')
  if (tags.some((t) => /picnic/i.test(t))) highlights.push('Picnic areas')
  if (tags.some((t) => /wildflower/i.test(t))) highlights.push('Spring wildflowers')
  if (tags.some((t) => /wildlife/i.test(t))) highlights.push('Wildlife spotting')
  if (tags.some((t) => /quiet/i.test(t))) highlights.push('Peaceful & quiet')
  if (tags.some((t) => /family/i.test(t))) highlights.push('Family-friendly')
  if (tags.some((t) => /camp/i.test(t))) highlights.push('Camping')
  if (tags.some((t) => /farm|market/i.test(t))) highlights.push('Farmers market')
  if (highlights.length === 0) return null
  return (
    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl px-5 py-4 mb-6 animate-fade-up animate-fade-up-delay-1">
      <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mb-2.5">🌿 Best For</p>
      <div className="flex flex-wrap gap-2">
        {highlights.map((h) => (
          <span key={h} className="text-[13px] font-medium bg-white border border-emerald-200 text-emerald-800 rounded-full px-3 py-1">{h}</span>
        ))}
      </div>
    </div>
  )
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params
  const [item, rating] = await Promise.all([getItem(id), getItemRating(id)])
  if (!item) notFound()

  const category         = getCategoryBySlug(item.category)
  const subcategoryLabel = getSubcategoryLabel(item.category, item.subcategory)
  const dateTimeStr      = formatDateTime(item.start_time, item.end_time)
  const googleUrl        = buildGoogleMapsUrl(item.address, item.latitude, item.longitude)
  const appleUrl         = buildAppleMapsUrl(item.address, item.latitude, item.longitude)
  // Prefer structured known_for (actual dishes) over tag-derived fallback
  const knownForItems    = (item.known_for ?? []).filter(Boolean)
  const knownForFallback = knownForFromTags(item.tags ?? [])
  const isFood           = item.category === 'food'
  const isOutdoor        = item.category === 'outdoor'
  const isTrailLink      = isOutdoor && item.external_link && !item.external_link.includes('maps.google.com')
  const lowDetail        = isLowDetail(item)
  const trailMeta        = isOutdoor ? parseTrailMeta(item.known_for) : null

  const validSubcategory = category?.subcategories.find((s) => s.slug === item.subcategory)
  const backHref = category && validSubcategory
    ? `/${item.category}/${item.subcategory}`
    : category ? `/${item.category}` : '/'

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <ViewTracker itemId={item.id} category={item.category} title={item.title} />
      <Header showBack backHref={backHref} backLabel={subcategoryLabel} />

      <main className="flex-1 max-w-[720px] mx-auto w-full px-6 py-10">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] mb-6 animate-fade-up">
          <Link href="/" className="hover:text-[#6B7280] transition-colors">Home</Link>
          <span>/</span>
          <Link href={`/${item.category}`} className="hover:text-[#6B7280] transition-colors capitalize">
            {category?.label ?? item.category}
          </Link>
          <span>/</span>
          <Link href={backHref} className="hover:text-[#6B7280] transition-colors">
            {subcategoryLabel}
          </Link>
        </nav>

        {/* Hero — real image when available, intentional fallback otherwise */}
        <div className="relative w-full rounded-3xl overflow-hidden bg-[#F3F4F6] mb-8 animate-fade-up"
          style={{ aspectRatio: '16/9' }}>
          {item.flyer_image_url ? (
            <Image src={item.flyer_image_url} alt={item.title} fill
              className="object-cover" sizes="720px" priority />
          ) : (
            <FallbackHero category={item.category} title={item.title} />
          )}
          <div className="absolute top-4 right-4">
            <FavoriteButton id={item.id} />
          </div>
        </div>

        {/* Title + category chips */}
        <div className="flex items-start justify-between gap-4 mb-3 animate-fade-up animate-fade-up-delay-1">
          <div className="flex-1 min-w-0">
            <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-[#111111] leading-tight mb-3">
              {item.title}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-medium bg-[#F3F4F6] text-[#6B7280] rounded-full px-3 py-1">
                {category?.icon} {category?.label}
              </span>
              <span className="text-[12px] font-medium bg-[#F3F4F6] text-[#6B7280] rounded-full px-3 py-1">
                {subcategoryLabel}
              </span>
              {/* Rating near title */}
              <RatingBadge
                avgRating={rating.avg_rating}
                reviewCount={rating.review_count}
                size="sm"
                showEmpty={!item.start_time} // show "No ratings yet" only for places
              />
            </div>
          </div>
        </div>

        {/* Prominent event date banner — shown for events with a start_time */}
        {item.start_time && (
          <EventDateBanner start_time={item.start_time} end_time={item.end_time} />
        )}

        {/* Description — shown prominently before details */}
        {cleanDescription(item.description) ? (
          <div className="mb-5 animate-fade-up animate-fade-up-delay-1">
            <p className="text-[16px] text-[#374151] leading-relaxed whitespace-pre-line">{cleanDescription(item.description)}</p>
          </div>
        ) : lowDetail && (
          /* Low-detail fallback notice */
          <div className="mb-5 animate-fade-up animate-fade-up-delay-1">
            <div className="flex items-start gap-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl px-4 py-3.5 text-[13px] text-[#6B7280]">
              <span className="text-lg leading-none mt-0.5">ℹ️</span>
              <p>
                No description available for this listing.
                {item.external_link
                  ? ' Visit the official page for full details.'
                  : ' Use the map links below to find this location.'}
              </p>
            </div>
          </div>
        )}

        {/* Tags */}
        {(item.tags ?? []).length > 0 && (
          <div className="mb-5 animate-fade-up animate-fade-up-delay-1">
            <TagSection tags={item.tags ?? []} />
          </div>
        )}

        {/* Known For / Recommended Dishes block — only for non-outdoor */}
        {!isOutdoor && (knownForItems.length > 0 ? (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-2xl px-5 py-4 mb-6 animate-fade-up animate-fade-up-delay-1">
            <p className="text-[11px] font-bold text-orange-500 uppercase tracking-widest mb-2.5">🍽 Recommended</p>
            <div className="flex flex-wrap gap-2">
              {knownForItems.map((dish) => (
                <span key={dish} className="text-[13px] font-medium bg-white border border-orange-200 text-orange-800 rounded-full px-3 py-1">
                  {dish}
                </span>
              ))}
            </div>
          </div>
        ) : knownForFallback ? (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-2xl px-5 py-4 mb-6 animate-fade-up animate-fade-up-delay-1">
            <p className="text-[11px] font-bold text-orange-500 uppercase tracking-widest mb-1">Known for</p>
            <p className="text-[14px] font-semibold text-orange-900">{knownForFallback}</p>
          </div>
        ) : null)}

        {/* Trail facts + highlights — only for outdoor items */}
        {isOutdoor && <TrailFacts item={item} />}
        {isOutdoor && <TrailHighlights item={item} />}

        {/* Details card */}
        <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 mb-6 flex flex-col gap-4 shadow-sm animate-fade-up animate-fade-up-delay-2">
          {/* Location */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#F3F4F6] flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-4 h-4 text-[#6B7280]" />
            </div>
            <div>
              {item.location_name && (
                <p className="text-[15px] font-semibold text-[#111111]">{item.location_name}</p>
              )}
              <p className="text-[13px] text-[#6B7280] mt-0.5">{item.address}</p>
            </div>
          </div>

          {/* Date / time — only shown in details card when there's no prominent banner above */}
          {dateTimeStr && !item.start_time && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#F3F4F6] flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-[#6B7280]" />
              </div>
              <p className="text-[15px] text-[#111111]">{dateTimeStr}</p>
            </div>
          )}

          {/* City / region */}
          {(item.city || item.region) && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#F3F4F6] flex items-center justify-center shrink-0">
                <Map className="w-4 h-4 text-[#6B7280]" />
              </div>
              <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
                {item.city && <span>{item.city}</span>}
                {item.city && item.region && <span className="text-[#D1D5DB]">·</span>}
                {item.region && <span className="capitalize">{item.region.replace(/-/g, ' ')}</span>}
              </div>
            </div>
          )}

          {/* Languages — events and food only; intentionally hidden for outdoor/campus/study/shopping */}
          {(item.category === 'events' || item.category === 'food') && (() => {
            const langs   = detectLanguages(item.title, item.description, item.tags ?? [])
            const display = formatLanguageDisplay(langs)
            if (!display) return null
            return (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F3F4F6] flex items-center justify-center shrink-0">
                  <span className="text-sm">🌐</span>
                </div>
                <p className="text-[13px] text-[#6B7280]">{display.label}</p>
              </div>
            )
          })()}
        </div>

        {/* Map preview — shown when we have coordinates */}
        {item.latitude && item.longitude && (
          <MapPreview lat={item.latitude} lng={item.longitude} address={item.address} />
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-3 animate-fade-up animate-fade-up-delay-3">
          {/* View Menu — most prominent for food places */}
          {isFood && item.menu_link && (
            <a href={item.menu_link} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-[#111111] text-white text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#333] active:scale-[0.99] transition-all duration-150">
              <UtensilsCrossed className="w-4 h-4" />
              View Menu
            </a>
          )}

          {isOutdoor ? (
            /* Outdoor: ONE primary CTA — trail link or a direct maps button */
            isTrailLink ? (
              <a href={item.external_link!} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#111111] text-white text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#333] active:scale-[0.99] transition-all duration-150">
                <ExternalLink className="w-4 h-4" />
                🥾 View Trail
              </a>
            ) : (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#111111] text-white text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#333] active:scale-[0.99] transition-all duration-150">
                <Map className="w-4 h-4" />
                Open in Maps
              </a>
            )
          ) : (
            <>
              {/* Official Page — only show when it's NOT just a Google Maps redirect */}
              {item.external_link && !isGoogleMapsLink(item) && (
                <a href={item.external_link} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-[#111111] text-white text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#333] active:scale-[0.99] transition-all duration-150">
                  <ExternalLink className="w-4 h-4" />
                  {externalButtonLabel(item)}
                </a>
              )}
              {/* Add to Calendar — events with a start_time */}
              {item.start_time && (
                <CalendarButton itemId={item.id} />
              )}
              <MapButtons googleUrl={googleUrl} appleUrl={appleUrl} size="lg" />
            </>
          )}
        </div>

        {/* Reviews */}
        <ReviewSection itemId={item.id} />

        {/* Similar events / more like this */}
        <Suspense fallback={null}>
          <SimilarEvents
            currentId={item.id}
            category={item.category}
            subcategory={item.subcategory}
            tags={item.tags ?? []}
          />
        </Suspense>

        {/* Nearby outdoor spots — only for outdoor items with coordinates */}
        {isOutdoor && item.latitude && item.longitude && (
          <Suspense fallback={null}>
            <NearbyTrails
              currentId={item.id}
              latitude={item.latitude}
              longitude={item.longitude}
              subcategory={item.subcategory}
              difficulty={trailMeta?.difficulty}
              tags={item.tags ?? []}
            />
          </Suspense>
        )}

        {/* Back link */}
        <div className="mt-8 text-center animate-fade-up">
          <Link href={backHref}
            className="inline-flex items-center gap-1.5 text-[13px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to {subcategoryLabel}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
