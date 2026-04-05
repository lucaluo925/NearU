import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export const DAVIS_TZ = 'America/Los_Angeles'

// ── Shared LA-timezone day boundaries ─────────────────────────────────────────
// Exported so EventsTimeline (server component) and api/items/route.ts always
// use identical date-boundary logic — no more UTC vs PDT drift between sections.

/** ISO date string (YYYY-MM-DD) for a Date in LA timezone */
function laDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ }).format(d)
}

/**
 * UTC Date that corresponds to midnight (00:00:00) in LA on the calendar day
 * `offsetDays` ahead of today's LA date.
 *
 * Strategy: probe noon-UTC on the target day to find the exact UTC offset
 * (handles DST correctly), then compute midnight LA in UTC.
 */
export function startOfLADay(now: Date, offsetDays = 0): Date {
  const [y, m, day] = laDateStr(now).split('-').map(Number)
  const noonUTC = new Date(Date.UTC(y, m - 1, day + offsetDays, 12, 0, 0))
  const laHourAtNoon =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: DAVIS_TZ,
        hour: '2-digit',
        hour12: false,
      }).format(noonUTC),
      10,
    ) % 24  // guard against the rare "24" midnight quirk in some JS engines
  const utcOffsetH = 12 - laHourAtNoon
  return new Date(Date.UTC(y, m - 1, day + offsetDays, utcOffsetH, 0, 0, 0))
}

/**
 * UTC Date that corresponds to the last millisecond (23:59:59.999) of the LA
 * calendar day `offsetDays` ahead of today.
 */
export function endOfLADay(now: Date, offsetDays = 0): Date {
  return new Date(startOfLADay(now, offsetDays + 1).getTime() - 1)
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    timeZone: DAVIS_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', {
    timeZone: DAVIS_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDateTime(start?: string, end?: string): string {
  if (!start) return ''
  const startDate = new Date(start)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ })
  const startDayLA = dayFmt.format(startDate)
  const todayLA    = dayFmt.format(now)
  // Use startOfLADay(+1) so "tomorrow" is always the next LA calendar day,
  // not a naive UTC +24 h that breaks across DST transitions.
  const tomorrowLA = dayFmt.format(startOfLADay(now, 1))

  let dateLabel = ''
  if (startDayLA === todayLA) {
    dateLabel = 'Today'
  } else if (startDayLA === tomorrowLA) {
    dateLabel = 'Tomorrow'
  } else {
    dateLabel = formatDate(start)
  }

  const timeLabel = formatTime(start)
  if (end) {
    return `${dateLabel} · ${timeLabel} – ${formatTime(end)}`
  }
  return `${dateLabel} · ${timeLabel}`
}

export function getTimeLabel(start?: string): 'today' | 'this-week' | 'upcoming' | null {
  if (!start) return null
  const date = new Date(start)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ })
  const dateDayLA = dayFmt.format(date)
  const todayLA   = dayFmt.format(now)
  if (dateDayLA === todayLA) return 'today'
  if (date > now && date <= new Date(now.getTime() + 7 * 86400000)) return 'this-week'
  return 'upcoming'
}

export function buildGoogleMapsUrl(address: string, lat?: number, lng?: number): string {
  if (lat && lng) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export function buildAppleMapsUrl(address: string, lat?: number, lng?: number): string {
  if (lat && lng) {
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(address)}`
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`
}

export function isExpired(end_time?: string): boolean {
  if (!end_time) return false
  return new Date(end_time) < new Date()
}

export function isToday(dateStr?: string): boolean {
  if (!dateStr) return false
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAVIS_TZ })
  return dayFmt.format(new Date(dateStr)) === dayFmt.format(new Date())
}

/**
 * Haversine distance between two lat/lng points in miles.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export function radiusBoundingBox(lat: number, lng: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69.0
  const lngDelta = radiusMiles / (69.0 * Math.cos((lat * Math.PI) / 180))
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  }
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return '< 0.1 mi'
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

export function isThisWeek(dateStr?: string): boolean {
  if (!dateStr) return false
  const date = new Date(dateStr)
  const now = new Date()
  return date >= now && date <= new Date(now.getTime() + 7 * 86400000)
}

/**
 * Strip common markdown formatting artifacts from ingested descriptions.
 */
export function cleanDescription(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/\*([^\n*]{1,200})\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/_([^\n_]{1,200})_/g, '$1')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?<![a-zA-Z0-9])\*(?![a-zA-Z0-9*])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned || null
}
