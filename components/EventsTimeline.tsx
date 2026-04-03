/**
 * EventsTimeline — server component
 * Shows upcoming events grouped by Today / Tomorrow / This Weekend.
 * All date boundaries computed in America/Los_Angeles timezone.
 */

import Link from 'next/link'
import Image from 'next/image'
import { Calendar, Clock, MapPin, ArrowRight } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'
import { formatTime, formatDate } from '@/lib/utils'
import { CATEGORIES } from '@/lib/constants'
import { cn } from '@/lib/utils'

const LA_TZ = 'America/Los_Angeles'

// ── LA timezone helpers ───────────────────────────────────────────────────────

/** ISO date string (YYYY-MM-DD) for today in LA timezone */
function laToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LA_TZ }).format(now)
}

/** Current hour (0–23) in LA timezone */
function laCurrentHour(now: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: LA_TZ, hour: '2-digit', hour12: false }).format(now),
    10,
  )
}

/** Current weekday in LA timezone (0=Sun … 6=Sat) */
function laCurrentWeekday(now: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: LA_TZ, weekday: 'short' }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s)
}

/**
 * Return the UTC Date that corresponds to midnight (00:00:00) in LA on the date
 * that is `offsetDays` ahead of today's LA date.
 *
 * Strategy: probe noon-UTC on the target calendar day to determine the LA
 * UTC-offset (avoiding DST-transition edge cases), then subtract that offset to
 * find what UTC time equals midnight in LA.
 */
function startOfLADay(now: Date, offsetDays = 0): Date {
  const [y, m, d] = laToday(now).split('-').map(Number)
  const noonUTC = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0))
  const laHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: LA_TZ, hour: '2-digit', hour12: false }).format(noonUTC),
    10,
  )
  // PDT example: noon UTC = 5 AM LA → offset = 7  → midnight LA = 07:00 UTC
  const utcOffsetH = 12 - laHourAtNoon
  return new Date(Date.UTC(y, m - 1, d + offsetDays, utcOffsetH, 0, 0, 0))
}

function endOfLADay(now: Date, offsetDays = 0): Date {
  return new Date(startOfLADay(now, offsetDays + 1).getTime() - 1)
}

// ── Time ranges ───────────────────────────────────────────────────────────────

interface TimeRange { label: string; emoji: string; start: Date; end: Date; filterHref: string }

function getTimeRanges(): TimeRange[] {
  const now = new Date()
  const laHour = laCurrentHour(now)
  const laDay  = laCurrentWeekday(now)   // 0=Sun … 6=Sat

  const isEvening = laHour >= 17

  const todayEnd      = endOfLADay(now, 0)
  const tomorrowStart = startOfLADay(now, 1)
  const tomorrowEnd   = endOfLADay(now, 1)

  // Weekend: nearest upcoming Saturday→Sunday
  const daysToSat = laDay === 6 ? 0 : (6 - laDay)
  const satStart  = startOfLADay(now, daysToSat)
  const sunEnd    = endOfLADay(now, daysToSat + 1)

  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LA_TZ })
  const tomorrowDate = dayFmt.format(tomorrowStart)
  const satDate      = dayFmt.format(satStart)
  const sunDate      = dayFmt.format(sunEnd)

  const ranges: TimeRange[] = [
    {
      label:      isEvening ? 'Tonight' : 'Today',
      emoji:      isEvening ? '🌙' : '📅',
      start:      now,
      end:        todayEnd,
      filterHref: '/search?category=events&time=today',
    },
    {
      label:      'Tomorrow',
      emoji:      '🌅',
      start:      tomorrowStart,
      end:        tomorrowEnd,
      filterHref: `/search?category=events&dateFrom=${tomorrowDate}&dateTo=${tomorrowDate}`,
    },
    {
      label:      'This Weekend',
      emoji:      '🎉',
      start:      laDay <= 4 ? satStart : now,
      end:        sunEnd,
      filterHref: `/search?category=events&dateFrom=${satDate}&dateTo=${sunDate}`,
    },
  ]

  return ranges.filter((r) => r.end > now)
}

// ── Data fetch ────────────────────────────────────────────────────────────────

async function fetchEventsInRange(
  supabase: ReturnType<typeof getServerSupabase>,
  start: Date,
  end: Date,
  limit = 8,
): Promise<Item[]> {
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('category', 'events')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .gte('start_time', start.toISOString())
    .lte('start_time', end.toISOString())
    .order('start_time', { ascending: true })
    .limit(limit)
  return (data ?? []) as Item[]
}

// ── Event mini-card ───────────────────────────────────────────────────────────

const CAT_GRADIENT: Record<string, string> = {
  events:  'from-rose-100 to-pink-50',
  food:    'from-orange-100 to-amber-50',
  outdoor: 'from-emerald-100 to-green-50',
}

function isTonight(dateStr?: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LA_TZ })
  if (dayFmt.format(d) !== dayFmt.format(now)) return false
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: LA_TZ, hour: '2-digit', hour12: false })
  return parseInt(hourFmt.format(d), 10) >= 17
}

function isFree(tags?: string[] | null): boolean {
  return !!(tags?.some((t) => t === 'free' || t === 'free-for-students'))
}

// Fixed total height: h-[228px]
function EventMiniCard({ item }: { item: Item }) {
  const cat      = CATEGORIES.find((c) => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''
  const tonight  = isTonight(item.start_time)
  const free     = isFree(item.tags)

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group flex-none w-[200px] sm:w-[220px] h-[228px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image zone — always 116px */}
      <div className={cn('relative h-[116px] shrink-0 bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="220px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        {(tonight || free) && (
          <div className="absolute top-2 left-2 flex gap-1">
            {tonight && (
              <span className="text-[9px] font-medium text-violet-700 bg-white/90 border border-violet-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
                🌙 Tonight
              </span>
            )}
            {free && (
              <span className="text-[9px] font-medium text-emerald-700 bg-white/90 border border-emerald-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
                🆓 Free
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body — strictly structured */}
      <div className="flex flex-col p-3 flex-1 overflow-hidden">
        <h3
          className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors"
          style={{ minHeight: '2.5em' }}
        >
          {item.title}
        </h3>
        <div className="flex-1" />
        <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] h-[16px] overflow-hidden">
          {loc && <MapPin className="w-2.5 h-2.5 shrink-0" />}
          <span className="line-clamp-1">{loc}</span>
        </p>
        <div className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] h-[18px] mt-0.5 overflow-hidden">
          {time && (
            <>
              <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
              <span>{time}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function EventCount({ count, href }: { count: number; href: string }) {
  if (count === 0) return null
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors group"
    >
      <span>{count} event{count !== 1 ? 's' : ''}</span>
      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  )
}

function TimeSection({ range, items, totalCount }: { range: TimeRange; items: Item[]; totalCount: number }) {
  if (totalCount === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[18px] leading-none">{range.emoji}</span>
          <h2 className="text-[15px] font-bold text-[#111111]">{range.label}</h2>
          <span className="text-[12px] text-[#9CA3AF] font-normal">&middot; {totalCount}</span>
        </div>
        <EventCount count={totalCount} href={range.filterHref} />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x snap-mandatory scrollbar-hide">
        {items.map((item) => (
          <div key={item.id} className="snap-start">
            <EventMiniCard item={item} />
          </div>
        ))}
        <Link
          href={range.filterHref}
          className="flex-none w-[120px] h-[228px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-[#F3F4F6] hover:border-[#D1D5DB] transition-colors snap-start"
        >
          <div className="w-9 h-9 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-[#374151]" />
          </div>
          <span className="text-[12px] font-semibold text-[#374151] text-center px-2">
            See all {range.label.toLowerCase()}
          </span>
        </Link>
      </div>
    </section>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default async function EventsTimeline() {
  const supabase = getServerSupabase()
  const ranges   = getTimeRanges()

  const [todayItems, tomorrowItems, weekendItems] = await Promise.all(
    ranges.map((r) => fetchEventsInRange(supabase, r.start, r.end, 8).catch(() => [])),
  )

  const allGroups = [
    { range: ranges[0], items: todayItems   ?? [] },
    { range: ranges[1], items: tomorrowItems ?? [] },
    { range: ranges[2], items: weekendItems  ?? [] },
  ].filter((g) => g.range && g.items.length > 0)

  if (allGroups.length === 0) return null

  const totalEvents = allGroups.reduce((s, g) => s + g.items.length, 0)

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-[#C4C9D4]" />
          <h2 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-widest">
            Coming Up
          </h2>
        </div>
        <Link
          href="/search?category=events"
          className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors group"
        >
          See all
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        {allGroups.map(({ range, items }) => (
          <TimeSection key={range.label} range={range} items={items} totalCount={items.length} />
        ))}
      </div>
    </section>
  )
}
