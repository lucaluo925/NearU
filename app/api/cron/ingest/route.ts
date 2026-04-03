import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { resolveCampusLocation } from '@/lib/campus-buildings'
import { parseICS, icsUidToSlug } from '@/lib/ingestion/ics'

// ── Locality validation ───────────────────────────────────────────────────────

/**
 * Cities/localities within the Davis/Sacramento region that are acceptable
 * for the local event feed. Be conservative — when in doubt, exclude.
 */
const LOCAL_LOCALITIES = new Set([
  'Davis', 'Woodland', 'West Sacramento', 'Sacramento',
  'Winters', 'Dixon', 'Vacaville', 'Fairfield',
  'Elk Grove', 'Rancho Cordova', 'Folsom', 'Roseville',
  'Citrus Heights', 'Natomas', 'Yolo',
])

/**
 * Returns true if the locality string (city name) is within the local region.
 * Returns true for empty/null (unknown = give benefit of the doubt for campus sources).
 */
function isLocalLocality(locality: string | null | undefined): boolean {
  if (!locality) return true  // unknown → trust the source
  return LOCAL_LOCALITIES.has(locality)
}

/**
 * Returns true if the address string clearly contains a non-California state,
 * indicating this event is not local at all.
 */
function hasNonCaliforniaState(address: string | null | undefined): boolean {
  if (!address) return false
  // Match state abbreviations that are NOT CA, surrounded by word boundaries
  return /\b(VA|TX|FL|MD|NY|IL|WA|OR|NV|AZ|CO|GA|NC|OH|PA|MA|MI|MN|HI|AK|ID|MT|WY|ND|SD|NE|KS|OK|LA|MS|AL|TN|KY|WV|IN|MO|IA|WI|AR)\b/.test(address)
}

// ── Geographic locality filter ────────────────────────────────────────────────

/** Davis, CA geographic center (Mrak Hall). */
const DAVIS_LAT = 38.5449
const DAVIS_LNG = -121.7405

/** Maximum allowed distance from Davis center, in miles. */
const MAX_RADIUS_MILES = 50

/** Haversine distance between two lat/lng points, in miles. */
function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Regex for local city names (broader, for string-only address matching). */
const LOCAL_ADDR_RE = /\b(davis|sacramento|west\s*sacramento|woodland|dixon|winters|vacaville|fairfield|elk\s*grove|rancho\s*cordova|folsom|roseville|citrus\s*heights|natomas|yolo)\b/i

/** Clearly non-local California cities (SoCal, Bay Area, Central Valley far south). */
const NONLOCAL_CA_RE = /\b(irvine|los\s*angeles|l\.?a\b|san\s*diego|anaheim|santa\s*ana|riverside|long\s*beach|san\s*jose|san\s*francisco|s\.?f\b|berkeley|oakland|fresno|bakersfield|stockton|modesto|santa\s*barbara|santa\s*cruz|san\s*luis\s*obispo|pasadena|burbank)\b/i

interface RejectionEntry {
  title:    string
  location: string
  reason:   'out_of_radius' | 'away_game' | 'invalid_location'
}

/**
 * Central locality gate applied before every upsert.
 *
 * Rules (in priority order):
 *  1. Coordinates present → haversine distance check (most authoritative)
 *  2. Athletics source     → reject away games by location + title pattern
 *  3. Non-CA US state      → reject
 *  4. Clearly non-local CA city → reject
 *  5. City explicitly set and not in LOCAL_LOCALITIES + not matching LOCAL_ADDR_RE → reject
 *  6. Unknown / no location → trust the source (give benefit of the doubt)
 */
function isLocalEvent(
  ev:         Record<string, unknown>,
  sourceType: string,
  log:        RejectionEntry[],
): boolean {
  const title   = String(ev.title          ?? '')
  const city    = String(ev.city           ?? '')
  const address = String(ev.address        ?? '')
  const locName = String(ev.location_name  ?? '')
  const lat     = typeof ev.latitude  === 'number' ? ev.latitude  as number : null
  const lng     = typeof ev.longitude === 'number' ? ev.longitude as number : null

  // ── 1. Coordinate-based distance check ─────────────────────────────────────
  if (lat != null && lng != null) {
    const dist = haversineDistanceMiles(DAVIS_LAT, DAVIS_LNG, lat, lng)
    if (dist > MAX_RADIUS_MILES) {
      log.push({ title, location: `${lat},${lng} (${dist.toFixed(0)}mi)`, reason: 'out_of_radius' })
      return false
    }
    return true  // within radius — accept regardless of city string
  }

  // ── 2. Athletics: away-game detection ──────────────────────────────────────
  if (sourceType === 'ucd-athletics') {
    const locLower    = (locName + ' ' + address).toLowerCase()
    const davisVenue  = /davis|aggie|shields|del\s*oro|hunt|rec\s*pool/i.test(locLower)
    // Title pattern: "UC Davis X at Opponent" — "at" as away preposition
    const awayInTitle = /\bat\s+(?!(?:davis|uc\s+davis)\b)/i.test(title)
    const hasLoc      = locName.trim() !== '' || address.trim() !== ''
    if ((hasLoc && !davisVenue) || awayInTitle) {
      log.push({ title, location: locName || address || '(no location)', reason: 'away_game' })
      return false
    }
  }

  // ── 3. Non-CA US state abbreviation ────────────────────────────────────────
  if (hasNonCaliforniaState(address)) {
    log.push({ title, location: address, reason: 'invalid_location' })
    return false
  }

  // ── 4. Clearly non-local California city ───────────────────────────────────
  const combined = `${city} ${address}`
  if (NONLOCAL_CA_RE.test(combined)) {
    log.push({ title, location: city || address, reason: 'invalid_location' })
    return false
  }

  // ── 5. Explicit non-local city (city field set, not matching local patterns) ─
  if (city && !LOCAL_LOCALITIES.has(city) && !LOCAL_ADDR_RE.test(city) && !LOCAL_ADDR_RE.test(address)) {
    log.push({ title, location: city, reason: 'invalid_location' })
    return false
  }

  // ── 6. Unknown location — trust the source ──────────────────────────────────
  return true
}

/**
 * Daily ingestion cron endpoint.
 * Runs at 10:00 UTC (≈ 3:00 AM PDT / 2:00 AM PST) — see vercel.json.
 * Protected by CRON_SECRET header.
 *
 * Source registry is in lib/ingestion/sources.ts.
 * Each source runs independently — one failure never stops others.
 *
 *  1.  ucd-library          RSS      events.library.ucdavis.edu   ✅ healthy
 *  2.  mondavi              HTML     mondaviarts.org/whats-on/    ✅ healthy
 *  3.  davis-downtown       ICS      davisdowntown.com            ✅ healthy
 *  4.  eventbrite-davis     JSON-LD  eventbrite.com/d/ca--davis   ✅ healthy
 *  5.  visit-davis          ICS      visitdavis.org               ⚠ weak (small)
 *  6.  ucd-website          HTML     ucdavis.edu/events           ⚠ weak
 *  7.  ucd-athletics          ICS      ucdavisaggies.com (Sidearm)  ✅ healthy (NOT WAF-blocked)
 *  8.  river-cats            ICS      milb.com/sacramento             ⚠ no ICS endpoint found
 *  9.  old-sacramento        ICS/JSON-LD  oldsacramento.com           ✅ healthy
 *  10. crocker-museum        JSON     crockerart.org (__NEXT_DATA__)  ✅ healthy
 *  10. woodland-city         ICS      cityofwoodland.gov              ✅ healthy
 *  11. meetup-sacramento     JSON-LD  meetup.com (Sacramento)         ✅ healthy
 *  12. visit-yolo            JSON-LD  visityoloco.com                 ⚠ weak (small)
 *  13. ucd-arboretum         HTML     arboretum.ucdavis.edu           ❌ blocked (WAF)
 *  14. manetti-shrem         HTML     manettishremmuseum.ucdavis.edu  ❌ blocked (WAF)
 *  15. ucd-student-affairs   HTML     studentaffairs.ucdavis.edu      ❌ blocked (WAF)
 *
 * Returns: { sources: { id: SourceStat, ... }, summary: {...} }
 */

const UA = 'Mozilla/5.0 (compatible; AggieMap/1.0; +https://aggiemap.app)'

// ── Fetch with retry ──────────────────────────────────────────────────────────

/**
 * Fetch with automatic retry on network errors (not HTTP errors).
 * Creates a fresh AbortSignal per attempt so timeouts don't carry over.
 */
async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs = 20_000,
  retries    = 2
): Promise<Response> {
  let lastError: Error = new Error('fetchWithRetry: no attempts made')
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      lastError = err as Error
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  throw lastError
}

// ── Shared date parser ───────────────────────────────────────────────────────

/**
 * Parse a date/time string from Drupal SiteFarm <time> elements.
 * Inner HTML has spans: "Apr 1, 2026 <span>@</span> <span>3:00pm - 5:00pm</span>"
 * Also handles ISO 8601 strings directly.
 */
function parseSitefarmDatetime(
  raw: string | null
): { start_time: string | null; end_time: string | null } | null {
  if (!raw) return { start_time: null, end_time: null }

  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const atIdx = text.indexOf('@')
  let datePart: string, timePart: string
  if (atIdx !== -1) {
    datePart = text.slice(0, atIdx).trim()
    timePart = text.slice(atIdx + 1).trim()
  } else {
    datePart = text
    timePart = ''
  }

  const dateParts = datePart.split(/\s*-\s*(?=[A-Z][a-z]{2}\s)/).map((s) => s.trim())
  const startDate = dateParts[0]
  const endDate   = dateParts[1] ?? null

  const normTime = (t: string | null) =>
    t ? t.replace(/^(\d{1,2}:\d{2})(am|pm)$/i, (_, hm, ap) => `${hm} ${ap.toUpperCase()}`) : null

  const times = timePart.split(/\s*-\s*/).map((s) => s.trim()).filter(Boolean)
  const startTime = normTime(times[0] ?? null)
  const endTime   = normTime(times[1] ?? null)

  if (!startDate) return { start_time: null, end_time: null }

  try {
    const startStr = startTime ? `${startDate} ${startTime}` : startDate
    const startDt  = new Date(startStr)
    if (isNaN(startDt.getTime())) return { start_time: null, end_time: null }

    const endDateForCheck = endDate ?? startDate
    const endStr          = endTime ? `${endDateForCheck} ${endTime}` : endDateForCheck
    const endDt           = new Date(endStr)
    const validEnd        = !isNaN(endDt.getTime())

    const cutoff   = new Date(Date.now() - 86400_000)
    const expiryDt = validEnd ? endDt : startDt
    if (expiryDt < cutoff) return null

    return { start_time: startDt.toISOString(), end_time: validEnd ? endDt.toISOString() : null }
  } catch {
    return { start_time: null, end_time: null }
  }
}

// ── Categorization ───────────────────────────────────────────────────────────

function categorizeEvent(title: string, hint = ''): string {
  const t = (title + ' ' + hint).toLowerCase()
  if (/career|job|recruit|intern|networking|professional|resume/.test(t)) return 'career-networking'
  if (/lecture|seminar|colloquium|symposium|talk|workshop|publish|training/.test(t)) return 'academic-lecture'
  if (/concert|music|perform|theatre|theater|gallery|exhibit|art|reading|author|folk|jazz/.test(t)) return 'arts-music'
  if (/sport|game|match|tournament|athlet|yoga|fitness/.test(t)) return 'sports'
  if (/volunteer|service|community|charity|weed|stewardship|cleanup/.test(t)) return 'volunteer'
  if (/club|org|association|society|meeting|group/.test(t)) return 'club-student-org'
  if (/picnic|party|social|mixer|reception|celebration/.test(t)) return 'social-party'
  return 'campus-events'
}

// ── Shared Supabase upsert ───────────────────────────────────────────────────

interface SourceStat {
  fetched:          number
  parsed:           number
  inserted:         number
  updated:          number
  skipped:          number
  failed:           number
  errors:           string[]
  no_insert_reason: string | null  // populated when inserted === 0 to explain why
  /** true for WAF-blocked / deprecated / domain-dead sources — expected, not a regression */
  blocked:          boolean
}

async function upsertEvents(
  supabase: ReturnType<typeof getServerSupabase>,
  events: Record<string, unknown>[],
  sourceType: string,
  stat: SourceStat
) {
  for (const item of events) {
    try {
      const { data: existing } = await supabase
        .from('items')
        .select('id, deleted_at')
        .eq('source_type', sourceType)
        .eq('external_id', item.external_id as string)
        .maybeSingle()

      if (existing) {
        if (existing.deleted_at) { stat.skipped++; continue }
        const { error } = await supabase.from('items').update({
          title:           item.title,
          start_time:      item.start_time,
          end_time:        item.end_time,
          location_name:   item.location_name,
          address:         item.address,
          latitude:        item.latitude,
          longitude:       item.longitude,
          flyer_image_url: item.flyer_image_url,
          last_seen_at:    item.last_seen_at,
        }).eq('id', existing.id)
        if (error) { stat.failed++; stat.errors.push(`update: ${error.message}`) }
        else stat.updated++
      } else {
        const { error } = await supabase.from('items').insert(item)
        if (error) {
          if (error.code === '23505') stat.skipped++
          else { stat.failed++; stat.errors.push(`insert: ${error.message}`) }
        } else {
          stat.inserted++
        }
      }
    } catch (err) {
      stat.failed++
      stat.errors.push(`item error: ${(err as Error).message}`)
    }
  }
}

// ── Source 1: UC Davis main events page ──────────────────────────────────────

function parseUCDArticle(block: string): Record<string, unknown> | null {
  try {
    // Try both `about` attribute and title href for slug
    const slugMatch = block.match(/about="\/events\/([^"]+)"/) ??
                      block.match(/href="\/events\/([^"]+)"/)
    const slug    = slugMatch?.[1] ?? null
    const baseUrl = 'https://www.ucdavis.edu'
    const eventUrl = slug ? `${baseUrl}/events/${slug}` : `${baseUrl}/events`

    // Title: <span class="field field--name-title...">
    const titleSpan = block.match(/<span class="field field--name-title[^"]*">([\s\S]*?)<\/span>/)
    // Fallback: <h3 class="vm-teaser__title"><a ...>Title</a></h3>
    const titleH3 = block.match(/<h3[^>]*vm-teaser__title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)
    const rawTitle = (titleSpan?.[1] ?? titleH3?.[1])
      ?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim()
    if (!rawTitle) return null

    const timeMatch = block.match(/<time class="datetime">([\s\S]*?)<\/time>/)
    const parsed    = parseSitefarmDatetime(timeMatch?.[1]?.trim() ?? null)
    if (parsed === null) return null

    const locMatch     = block.match(/icon--location[^>]*>([\s\S]*?)<\/div>/)
    const locationName = locMatch?.[1]?.replace(/<[^>]*>/g, '').trim() || null

    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/)
    let imageUrl: string | null = imgMatch?.[1] ?? null
    if (imageUrl && !imageUrl.startsWith('http')) imageUrl = `${baseUrl}${imageUrl}`

    const tags = ['student-friendly']
    if (/free|no cost|complimentary/i.test(block)) tags.push('free')
    if (/outdoor|outside|garden|arboretum|park/i.test(block)) tags.push('outdoor')

    const resolved = resolveCampusLocation(locationName)

    return {
      title: rawTitle.slice(0, 200), description: null,
      category: 'events', subcategory: categorizeEvent(rawTitle),
      location_name: locationName,
      address: resolved?.address ?? '1 Shields Ave, Davis, CA 95616',
      city: 'Davis', region: 'on-campus',
      latitude: resolved?.latitude ?? null, longitude: resolved?.longitude ?? null,
      start_time: parsed.start_time, end_time: parsed.end_time,
      external_link: eventUrl, flyer_image_url: imageUrl,
      source: 'ucd-website', source_type: 'ucd-website', source_url: eventUrl,
      external_id: slug ?? rawTitle.toLowerCase().replace(/\s+/g, '-').slice(0, 100),
      tags, last_seen_at: new Date().toISOString(),
    }
  } catch { return null }
}

async function fetchUCDMain(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://www.ucdavis.edu/events'
  try {
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
    if (!res.ok) { stat.errors.push(`UCD main HTTP ${res.status}`); return [] }
    const html = await res.text()
    const blocks = html.match(/<article\b[^>]*class="[^"]*node--type-sf-event[^"]*"[^>]*>[\s\S]*?<\/article>/g) ?? []
    stat.fetched = blocks.length
    // Filter out promotional/permanent activities that started more than 30 days ago
    // (e.g. "Shop at UC Davis Stores" with start 2024, end 2050 — not a real event)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    const parsed = blocks
      .map(parseUCDArticle)
      .filter((e): e is Record<string, unknown> => e !== null)
    const events = parsed.filter((e) => !e.start_time || new Date(e.start_time as string) >= thirtyDaysAgo)
    const promoFiltered = parsed.length - events.length
    stat.parsed = events.length
    // Distinguish "no real events on page" (healthy) from "parser broken" (fetched > 0 but 0 parsed)
    if (stat.fetched > 0 && events.length === 0) {
      if (promoFiltered > 0) {
        stat.no_insert_reason = `${stat.fetched} items fetched; ${promoFiltered} filtered as promotional/evergreen (multi-year span) — no real upcoming events`
      } else if (parsed.length === 0) {
        stat.no_insert_reason = `${stat.fetched} article blocks fetched but title/date selectors matched nothing — page structure may have changed`
      } else {
        stat.no_insert_reason = `${stat.fetched} items fetched but none passed date filter — no real upcoming events`
      }
    }
    return events
  } catch (err) {
    stat.errors.push(`UCD main fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 2: UC Davis Library (Localist RSS) ─────────────────────────────────

function xmlGet(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`, 'i'
  ))
  return m ? (m[1] ?? m[2] ?? '').trim() : null
}
function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}=['"]([^'"]+)['"]`))
  return m?.[1] ?? null
}

function parseLibraryItem(itemXml: string): Record<string, unknown> | null {
  try {
    const rawTitle = xmlGet(itemXml, 'title')
    if (!rawTitle) return null
    const decode = (s: string) => s
      .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&#039;/g, "'")
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const title = decode(rawTitle.replace(/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}:\s*/, '').trim())
    if (!title) return null

    const dcDate = xmlGet(itemXml, 'dc:date')
    if (!dcDate) return null
    const startDt = new Date(dcDate)
    if (isNaN(startDt.getTime())) return null
    if (startDt < new Date(Date.now() - 86400_000)) return null

    const link     = xmlGet(itemXml, 'link')
    const imageUrl = xmlAttr(itemXml, 'media:content', 'url')
    const category = xmlGet(itemXml, 'category') ?? ''
    const guid     = xmlGet(itemXml, 'guid') ?? ''
    const latStr   = xmlGet(itemXml, 'geo:lat')
    const lngStr   = xmlGet(itemXml, 'geo:long')

    const slugMatch  = link?.match(/\/event\/([^/?#]+)/)
    const slug       = slugMatch?.[1] ?? null
    const external_id = slug
      ? `ucd-library-${slug}`
      : `ucd-library-${guid.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(-40)}`

    const desc      = xmlGet(itemXml, 'description') ?? ''
    const isVirtual = /virtual|zoom|online/i.test(title + ' ' + desc)
    const resolved  = resolveCampusLocation('shields library')

    const tags = ['student-friendly']
    if (/free|no cost|complimentary/i.test(desc + ' ' + rawTitle)) tags.push('free')
    if (isVirtual) tags.push('virtual')

    return {
      title: title.slice(0, 200), description: null,
      category: 'events', subcategory: categorizeEvent(title, category),
      location_name: isVirtual ? 'Virtual / Zoom' : 'Shields Library',
      address: isVirtual ? 'Online' : (resolved?.address ?? 'Peter J. Shields Library, UC Davis, Davis, CA 95616'),
      city: 'Davis', region: isVirtual ? 'online' : 'on-campus',
      latitude:  isVirtual ? null : (latStr ? parseFloat(latStr) : (resolved?.latitude ?? 38.5403)),
      longitude: isVirtual ? null : (lngStr ? parseFloat(lngStr) : (resolved?.longitude ?? -121.7487)),
      start_time: startDt.toISOString(), end_time: null,
      external_link: link ?? 'https://events.library.ucdavis.edu',
      flyer_image_url: imageUrl ?? null,
      source: 'ucd-library', source_type: 'ucd-library',
      source_url: link ?? 'https://events.library.ucdavis.edu',
      external_id, tags, last_seen_at: new Date().toISOString(),
    }
  } catch { return null }
}

async function fetchLibrary(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://events.library.ucdavis.edu/calendar/1.xml'
  try {
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml' } })
    if (!res.ok) { stat.errors.push(`Library HTTP ${res.status}`); return [] }
    const xml    = await res.text()
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
    stat.fetched = blocks.length
    const events = blocks.map(parseLibraryItem).filter((e): e is Record<string, unknown> => e !== null)
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Library fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 3: UC Davis Arboretum ─────────────────────────────────────────────

async function fetchArboretum(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // arboretum.ucdavis.edu is behind the UC Davis WAF (Cloudflare).
  // All server-side HTTP requests return 403 Forbidden — expected, not fixable without a UCD ICS feed.
  stat.blocked = true
  stat.no_insert_reason = 'Blocked by UC Davis WAF (403) — expected, non-regressive'
  return []
}

// ── JSON-LD helpers (shared across new sources) ───────────────────────────────

function extractJsonLdEvents(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    try {
      const raw = JSON.parse(m[1].trim())
      const nodes = Array.isArray(raw) ? raw : [raw]
      for (const node of nodes) {
        if (node['@type'] === 'Event') results.push(node)
        if (Array.isArray(node['@graph'])) {
          for (const n of node['@graph']) {
            if (n['@type'] === 'Event') results.push(n)
          }
        }
      }
    } catch { /* malformed ld+json — skip */ }
  }
  return results
}

function parseJsonLdEvent(
  event: Record<string, unknown>,
  sourceKey: string,
  fallbackUrl: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> | null {
  try {
    const name = typeof event.name === 'string' ? event.name.trim() : null
    if (!name) return null

    const startDate = typeof event.startDate === 'string' ? event.startDate : null
    if (!startDate) return null
    const startDt = new Date(startDate)
    if (isNaN(startDt.getTime())) return null
    if (startDt < new Date(Date.now() - 86_400_000)) return null

    const endDate = typeof event.endDate === 'string' ? event.endDate : null
    const endDt   = endDate ? new Date(endDate) : null

    const url = typeof event.url === 'string' ? event.url : fallbackUrl

    const locObj     = event.location as Record<string, unknown> | undefined
    const locName    = typeof locObj?.name === 'string' ? locObj.name : null
    const addrObj    = locObj?.address as Record<string, unknown> | string | undefined
    const addrStr    = typeof addrObj === 'string'
      ? addrObj
      : (typeof addrObj?.streetAddress === 'string'
          ? `${addrObj.streetAddress}, ${addrObj.addressLocality ?? 'Davis'}, CA`
          : null)

    const imgRaw  = event.image as string | Record<string, unknown> | undefined
    const imgUrl  = typeof imgRaw === 'string' ? imgRaw
      : typeof imgRaw?.url === 'string' ? imgRaw.url : null

    const resolved = resolveCampusLocation(locName)

    const slug       = url.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '-').slice(0, 80)
    const external_id = `${sourceKey}-${slug}`

    // Extract actual city from JSON-LD address
    const addrLocalityRaw = typeof addrObj === 'object' && addrObj !== null
      ? (addrObj as Record<string, unknown>).addressLocality
      : null
    const addrLocality = typeof addrLocalityRaw === 'string' ? addrLocalityRaw.trim() : null

    // If the event has a known non-local locality, skip it
    if (!isLocalLocality(addrLocality)) return null

    const derivedCity = addrLocality ?? 'Davis'
    const region = derivedCity === 'Davis' ? 'on-campus'
      : ['Sacramento', 'West Sacramento'].includes(derivedCity) ? 'sacramento'
      : 'davis'

    return {
      title:           name.slice(0, 200),
      description:     null,
      category:        'events',
      subcategory:     categorizeEvent(name),
      location_name:   locName,
      address:         resolved?.address ?? addrStr ?? '1 Shields Ave, Davis, CA 95616',
      city:            derivedCity,
      region,
      latitude:        resolved?.latitude ?? null,
      longitude:       resolved?.longitude ?? null,
      start_time:      startDt.toISOString(),
      end_time:        endDt && !isNaN(endDt.getTime()) ? endDt.toISOString() : null,
      external_link:   url,
      flyer_image_url: imgUrl,
      source:          sourceKey,
      source_type:     sourceKey,
      source_url:      url,
      external_id,
      tags:            ['student-friendly'],
      last_seen_at:    new Date().toISOString(),
      ...overrides,
    }
  } catch {
    return null
  }
}

// ── Source 4: Mondavi Center ──────────────────────────────────────────────────

async function fetchMondavi(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // Correct URL confirmed: /whats-on/ (old /performances/ returns 404)
  const url = 'https://www.mondaviarts.org/whats-on/'
  const overrides = {
    subcategory:   'arts-music',
    location_name: 'Mondavi Center',
    address:       'Mondavi Center for the Performing Arts, 1 Shields Ave, Davis, CA 95616',
    latitude:      38.5401,
    longitude:     -121.7516,
    region:        'on-campus',
    tags:          ['student-friendly', 'arts-music'],
  }
  try {
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
    if (!res.ok) { stat.errors.push(`Mondavi HTTP ${res.status}`); return [] }
    const html = await res.text()

    // 1. Try JSON-LD first (fastest path)
    const ldEvents = extractJsonLdEvents(html)
    if (ldEvents.length > 0) {
      stat.fetched = ldEvents.length
      const events = ldEvents
        .map((e) => parseJsonLdEvent(e, 'mondavi', url, overrides))
        .filter((e): e is Record<string, unknown> => e !== null)
      stat.parsed = events.length
      return events
    }

    // 2. HTML parser: split on the exact outer card wrapper class.
    //
    //    Mondavi card structure (confirmed live):
    //      <div class="c-col c-event-card">
    //        <a class="c-event-card__link" href="...">  ← only has sr-only title
    //        <div ...>
    //          <h3 class="c-event-card__title">Title</h3>
    //          <time class="c-event-card__time-label" datetime="2026-04-04T19:30:00-07:00">
    //
    //    IMPORTANT: split on the EXACT string "c-col c-event-card" (the outer wrapper),
    //    NOT on "c-event-card" alone — that substring also appears in sub-element class
    //    names (c-event-card__link, c-event-card__title, c-event-card__time-label),
    //    which would produce ~278 tiny fragments instead of 12 full cards.
    const cardSections = html.split('"c-col c-event-card"').slice(1)
    stat.fetched = cardSections.length

    const events: Record<string, unknown>[] = []
    for (const card of cardSections) {
      // ISO datetime from <time datetime="YYYY-MM-DDTHH:MM:SS±HH:MM">
      const dtM = card.match(/datetime="(\d{4}-\d{2}-\d{2}T[^"]+)"/)
      if (!dtM) continue
      const startDt = new Date(dtM[1])
      if (isNaN(startDt.getTime()) || startDt < new Date(Date.now() - 86_400_000)) continue

      // Title from c-event-card__title
      const titleM = card.match(/c-event-card__title[^>]*>([^<]+)</)
      const title  = titleM?.[1]?.replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
      if (!title) continue

      // href — Mondavi event URLs are always on mondaviarts.org/whats-on/
      const hrefM = card.match(/href="(https?:\/\/[^"]+)"/)
      const evUrl = hrefM?.[1] ?? url
      const slug  = evUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 80)

      // Image URL from data-srcset or src
      const imgM  = card.match(/data-srcset="([^"]+)"/) ?? card.match(/src="(https?:\/\/images\.mondaviarts[^"]+)"/)
      const imgUrl = imgM?.[1]?.split(',')[0]?.split(/\s/)[0] ?? null

      events.push({
        title:           title.slice(0, 200),
        description:     null,
        category:        'events',
        start_time:      startDt.toISOString(),
        end_time:        null,
        external_link:   evUrl,
        flyer_image_url: imgUrl,
        source:          'mondavi',
        source_type:     'mondavi',
        source_url:      evUrl,
        external_id:     `mondavi-${slug}`,
        last_seen_at:    new Date().toISOString(),
        ...overrides,
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Mondavi fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 5: Manetti Shrem Museum ───────────────────────────────────────────

async function fetchManettiShrem(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // manettishremmuseum.ucdavis.edu is behind the UC Davis WAF (Cloudflare).
  // All server-side requests return 403 — expected, non-regressive.
  stat.blocked = true
  stat.no_insert_reason = 'Blocked by UC Davis WAF (403) — expected, non-regressive'
  return []
}

// ── Source 6: UC Davis Student Affairs ───────────────────────────────────────

async function fetchUCDStudentAffairs(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // studentaffairs.ucdavis.edu is behind the UC Davis WAF (Cloudflare).
  // Both the RSS feed and the HTML events page return 403 — expected, non-regressive.
  stat.blocked = true
  stat.no_insert_reason = 'Blocked by UC Davis WAF (403) — expected, non-regressive'
  return []
}

// ── Source 7: Davis Downtown (ICS) ───────────────────────────────────────────

async function fetchDavisDowntown(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://davisdowntown.com/events/?ical=1'
  // Downtown Davis coordinates (G St & 2nd St)
  const DEFAULT_LAT = 38.5449
  const DEFAULT_LNG = -121.7414
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, text/plain' },
    })
    if (!res.ok) { stat.errors.push(`Davis Downtown HTTP ${res.status}`); return [] }
    const icsText  = await res.text()
    const icsEvents = parseICS(icsText)
    stat.fetched = icsEvents.length

    const events: Record<string, unknown>[] = []
    for (const ev of icsEvents) {
      if (!ev.dtstart) continue

      const external_id = `davis-downtown-${icsUidToSlug(ev.uid)}`
      const resolved    = resolveCampusLocation(ev.location)
      const body        = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
      const tags        = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')
      if (/outdoor|garden|park|plaza|street/i.test(body)) tags.push('outdoor')
      if (/music|concert|band|dj|live performance/i.test(body)) tags.push('arts-music')

      events.push({
        title:           ev.summary.slice(0, 200),
        description:     ev.description ?? null,
        category:        'events',
        subcategory:     categorizeEvent(ev.summary, ev.description ?? ''),
        location_name:   ev.location ?? 'Davis Downtown',
        address:         resolved?.address ?? `${ev.location ?? 'Davis Downtown'}, Davis, CA 95616`,
        city:            'Davis',
        region:          'davis',
        latitude:        resolved?.latitude ?? DEFAULT_LAT,
        longitude:       resolved?.longitude ?? DEFAULT_LNG,
        start_time:      ev.dtstart.toISOString(),
        end_time:        ev.dtend?.toISOString() ?? null,
        external_link:   ev.url ?? 'https://davisdowntown.com/events/',
        flyer_image_url: null,
        source:          'davis-downtown',
        source_type:     'davis-downtown',
        source_url:      ev.url ?? url,
        external_id,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Davis Downtown fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 8: Visit Davis (ICS) ──────────────────────────────────────────────

async function fetchVisitDavis(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://visitdavis.org/events-calendar/?ical=1'
  const DEFAULT_LAT = 38.5449
  const DEFAULT_LNG = -121.7414
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, text/plain' },
    })
    if (!res.ok) { stat.errors.push(`Visit Davis HTTP ${res.status}`); return [] }
    const icsText  = await res.text()
    const icsEvents = parseICS(icsText)
    stat.fetched = icsEvents.length

    const events: Record<string, unknown>[] = []
    for (const ev of icsEvents) {
      if (!ev.dtstart) continue

      const external_id = `visit-davis-${icsUidToSlug(ev.uid)}`
      const resolved    = resolveCampusLocation(ev.location)
      const body        = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
      const tags        = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')
      if (/outdoor|garden|park|winery|farm|trail/i.test(body)) tags.push('outdoor')

      events.push({
        title:           ev.summary.slice(0, 200),
        description:     ev.description ?? null,
        category:        'events',
        subcategory:     categorizeEvent(ev.summary, ev.description ?? ''),
        location_name:   ev.location ?? 'Davis, CA',
        address:         resolved?.address ?? `${ev.location ?? 'Davis'}, CA 95616`,
        city:            'Davis',
        region:          'davis',
        latitude:        resolved?.latitude ?? DEFAULT_LAT,
        longitude:       resolved?.longitude ?? DEFAULT_LNG,
        start_time:      ev.dtstart.toISOString(),
        end_time:        ev.dtend?.toISOString() ?? null,
        external_link:   ev.url ?? 'https://visitdavis.org/events-calendar/',
        flyer_image_url: null,
        source:          'visit-davis',
        source_type:     'visit-davis',
        source_url:      ev.url ?? url,
        external_id,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Visit Davis fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 9: Eventbrite — Davis, CA (JSON-LD) ───────────────────────────────

async function fetchEventbriteDavis(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://www.eventbrite.com/d/ca--davis/events/'
  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          // Use a realistic browser UA — Eventbrite serves a reduced page to bots
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:          'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      25_000
    )
    if (!res.ok) { stat.errors.push(`Eventbrite HTTP ${res.status}`); return [] }
    const html = await res.text()

    // Eventbrite embeds an ItemList JSON-LD block on the search page
    const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
    if (!ldMatch) { stat.errors.push('Eventbrite: no JSON-LD found on page'); return [] }

    let ldData: Record<string, unknown>
    try { ldData = JSON.parse(ldMatch[1].trim()) }
    catch { stat.errors.push('Eventbrite: JSON-LD parse error'); return [] }

    const rawItems = (ldData['itemListElement'] as unknown[]) ?? []
    stat.fetched = rawItems.length

    const yesterday = new Date(Date.now() - 86_400_000)
    const events: Record<string, unknown>[] = []

    for (const listItem of rawItems) {
      const item = listItem as Record<string, unknown>
      const ev   = item['item'] as Record<string, unknown> | undefined
      if (!ev) continue

      const name = typeof ev['name'] === 'string' ? ev['name'].trim() : null
      if (!name) continue

      const startStr = typeof ev['startDate'] === 'string' ? ev['startDate'] : null
      if (!startStr) continue

      // Eventbrite gives date-only strings ("2026-04-04") for most events
      // Assume noon PDT (UTC-7) so the date is correct for Davis
      const startDt = new Date(
        startStr.length === 10 ? `${startStr}T12:00:00-07:00` : startStr
      )
      if (isNaN(startDt.getTime()) || startDt < yesterday) continue

      const endStr  = typeof ev['endDate'] === 'string' ? ev['endDate'] : null
      const endDt   = endStr
        ? new Date(endStr.length === 10 ? `${endStr}T23:59:00-07:00` : endStr)
        : null

      const evUrl     = typeof ev['url'] === 'string' ? ev['url'] : url
      // Extract stable numeric event ID from Eventbrite URL: /e/slug-NUMBERS/
      const idMatch   = evUrl.match(/-(\d{6,})(?:\/|$|\?)/)
      const evId      = idMatch?.[1] ?? icsUidToSlug(evUrl).slice(-20)

      const locObj    = ev['location'] as Record<string, unknown> | undefined
      const locName   = typeof locObj?.['name'] === 'string' ? (locObj['name'] as string) : null
      const addrObj   = locObj?.['address'] as Record<string, unknown> | undefined
      const locality  = typeof addrObj?.['addressLocality'] === 'string'
        ? (addrObj['addressLocality'] as string)
        : ''

      // Only keep Davis-area events
      if (locality && !LOCAL_LOCALITIES.has(locality)) continue

      const streetAddr = typeof addrObj?.['streetAddress'] === 'string'
        ? addrObj['streetAddress'] as string
        : null
      const fullAddress = streetAddr
        ? `${streetAddr}, ${locality || 'Davis'}, CA`
        : `${locality || 'Davis'}, CA 95616`

      const region = locality === 'Davis' ? 'davis'
        : ['Sacramento', 'West Sacramento'].includes(locality) ? 'sacramento'
        : 'davis'

      const body = name.toLowerCase()
      const tags = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')
      if (/outdoor|garden|park|plaza/i.test(body))  tags.push('outdoor')

      events.push({
        title:           name.slice(0, 200),
        description:     null,
        category:        'events',
        subcategory:     categorizeEvent(name),
        location_name:   locName,
        address:         fullAddress,
        city:            locality || 'Davis',
        region,
        latitude:        null,
        longitude:       null,
        start_time:      startDt.toISOString(),
        end_time:        endDt && !isNaN(endDt.getTime()) ? endDt.toISOString() : null,
        external_link:   evUrl,
        flyer_image_url: null,
        source:          'eventbrite-davis',
        source_type:     'eventbrite-davis',
        source_url:      evUrl,
        external_id:     `eventbrite-davis-${evId}`,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Eventbrite fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 10: UC Davis Athletics (Sidearm Sports ICS) ───────────────────────

async function fetchUCDAthleticsEvents(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // ucdavisaggies.com (Sidearm Sports platform) serves a valid ICS for ALL UC Davis sports.
  // NOTE: This domain is NOT blocked by the UC Davis WAF — unlike *.ucdavis.edu subdomains.
  const url = 'https://ucdavisaggies.com/calendar.ashx?type=ics'
  const resolved = resolveCampusLocation('aggie stadium')
  const DEFAULT_LAT = resolved?.latitude  ?? 38.5384
  const DEFAULT_LNG = resolved?.longitude ?? -121.7488
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, application/x-vcalendar, text/plain, */*' },
    })
    if (!res.ok) { stat.errors.push(`UCD Athletics HTTP ${res.status}`); return [] }
    const icsText = await res.text()
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      stat.errors.push('UCD Athletics: response is not ICS (missing BEGIN:VCALENDAR)')
      return []
    }
    const icsEvents = parseICS(icsText)
    stat.fetched = icsEvents.length

    const events: Record<string, unknown>[] = []
    for (const ev of icsEvents) {
      if (!ev.dtstart) continue

      // Only ingest HOME games — away games have no value to a Davis user
      // Check BOTH location field AND title pattern for belt-and-suspenders safety
      const locDavis   = !ev.location || /davis|aggie|shields|del\s*oro|hunt|rec\s*pool/i.test(ev.location)
      const awayInTitle = /\bat\s+(?!(?:davis|uc\s+davis)\b)/i.test(ev.summary)
      const isHome = locDavis && !awayInTitle
      if (!isHome) { stat.skipped++; continue }

      const external_id = `ucd-athletics-${icsUidToSlug(ev.uid)}`
      const body  = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
      const tags  = ['student-friendly', 'sports']

      events.push({
        title:           ev.summary.slice(0, 200),
        description:     ev.description ?? null,
        category:        'events',
        subcategory:     'sports',
        location_name:   ev.location ?? 'UC Davis Athletics',
        address:         resolved?.address ?? '1 Shields Ave, Davis, CA 95616',
        city:            'Davis',
        region:          'on-campus',
        latitude:        DEFAULT_LAT,
        longitude:       DEFAULT_LNG,
        start_time:      ev.dtstart.toISOString(),
        end_time:        ev.dtend?.toISOString() ?? null,
        external_link:   ev.url ?? 'https://ucdavisaggies.com/calendar',
        flyer_image_url: null,
        source:          'ucd-athletics',
        source_type:     'ucd-athletics',
        source_url:      ev.url ?? url,
        external_id,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`UCD Athletics fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 11: Sacramento River Cats (MiLB ICS) ──────────────────────────────

async function fetchRiverCats(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // milb.com ICS was deprecated (returns HTML SPA shell as of 2026-04).
  // Fix: MLB Stats API (public, no auth) — team ID 105 = Sacramento River Cats.
  const TEAM_ID   = 105
  const SUTTER_LAT  = 38.5807
  const SUTTER_LNG  = -121.5004
  const SUTTER_ADDR = '400 Ballpark Dr, West Sacramento, CA 95691'

  const startDate = new Date().toISOString().slice(0, 10)
  const endDate   = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${TEAM_ID}&sportId=11&startDate=${startDate}&endDate=${endDate}&gameType=R`

  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!res.ok) { stat.errors.push(`River Cats: Stats API HTTP ${res.status}`); return [] }

    const json = await res.json() as { dates?: Array<{ date: string; games: Array<Record<string, unknown>> }> }
    const dates = json.dates ?? []
    stat.fetched = dates.reduce((n, d) => n + (d.games?.length ?? 0), 0)

    const events: Record<string, unknown>[] = []
    for (const dateEntry of dates) {
      for (const game of (dateEntry.games ?? [])) {
        const teams    = (game.teams as Record<string, unknown>) ?? {}
        const homeInfo = (teams.home as Record<string, unknown>) ?? {}
        const homeTeam = ((homeInfo.team as Record<string, unknown>)?.name as string) ?? ''
        if (!homeTeam.includes('Sacramento')) continue  // home games only

        const awayTeam = (((teams.away as Record<string, unknown>)?.team as Record<string, unknown>)?.name as string) ?? 'Visiting Team'
        const gamePk   = game.gamePk as number
        const gameDate = game.gameDate as string  // ISO UTC e.g. "2026-04-08T01:45:00Z"
        const startDt  = new Date(gameDate)
        if (isNaN(startDt.getTime())) continue

        const endDt = new Date(startDt.getTime() + 3 * 60 * 60 * 1_000)
        const body  = `Sacramento River Cats AAA home game at Sutter Health Park.`
        const tags  = ['sports', 'baseball', 'family-friendly']

        events.push({
          title:           `Sacramento River Cats vs. ${awayTeam}`.slice(0, 200),
          description:     body,
          category:        'events',
          subcategory:     'sports',
          location_name:   'Sutter Health Park',
          address:         SUTTER_ADDR,
          city:            'West Sacramento',
          region:          'sacramento',
          latitude:        SUTTER_LAT,
          longitude:       SUTTER_LNG,
          start_time:      startDt.toISOString(),
          end_time:        endDt.toISOString(),
          external_link:   'https://www.milb.com/sacramento',
          flyer_image_url: null,
          source:          'river-cats',
          source_type:     'river-cats',
          source_url:      url,
          external_id:     `river-cats-${gamePk}`,
          tags,
          last_seen_at:    new Date().toISOString(),
        })
      }
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`River Cats: Stats API fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 12: Old Sacramento Waterfront (JSON-LD / ICS) ─────────────────────

async function fetchOldSacramento(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // The Events Calendar plugin — try ICS first, fall back to JSON-LD
  const icsUrl  = 'https://www.oldsacramento.com/events/?ical=1'
  const htmlUrl = 'https://www.oldsacramento.com/events/'
  const DEFAULT_LAT = 38.5805
  const DEFAULT_LNG = -121.5044

  // ── Try ICS first ──────────────────────────────────────────────────────────
  try {
    const res = await fetchWithRetry(icsUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, text/plain' },
    })
    if (res.ok) {
      const icsText = await res.text()
      if (icsText.includes('BEGIN:VCALENDAR')) {
        const icsEvents = parseICS(icsText)
        stat.fetched = icsEvents.length

        if (icsEvents.length > 0) {
          const events: Record<string, unknown>[] = []
          for (const ev of icsEvents) {
            if (!ev.dtstart) continue
            const body = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
            const tags = ['community']
            if (/free|no cost|complimentary/i.test(body)) tags.push('free')
            if (/outdoor|plaza|waterfront|street/i.test(body)) tags.push('outdoor')

            events.push({
              title:           ev.summary.slice(0, 200),
              description:     ev.description ?? null,
              category:        'events',
              subcategory:     categorizeEvent(ev.summary, ev.description ?? ''),
              location_name:   ev.location ?? 'Old Sacramento Waterfront',
              address:         ev.location
                ? `${ev.location}, Sacramento, CA`
                : '1002 2nd St, Sacramento, CA 95814',
              city:            'Sacramento',
              region:          'sacramento',
              latitude:        DEFAULT_LAT,
              longitude:       DEFAULT_LNG,
              start_time:      ev.dtstart.toISOString(),
              end_time:        ev.dtend?.toISOString() ?? null,
              external_link:   ev.url ?? htmlUrl,
              flyer_image_url: null,
              source:          'old-sacramento',
              source_type:     'old-sacramento',
              source_url:      ev.url ?? icsUrl,
              external_id:     `old-sacramento-${icsUidToSlug(ev.uid)}`,
              tags,
              last_seen_at:    new Date().toISOString(),
            })
          }
          stat.parsed = events.length
          return events
        }
      }
    }
  } catch { /* fall through to JSON-LD */ }

  // ── Fall back to JSON-LD ──────────────────────────────────────────────────
  try {
    const res = await fetchWithRetry(htmlUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) { stat.errors.push(`Old Sacramento HTTP ${res.status}`); return [] }
    const html      = await res.text()
    const ldEvents  = extractJsonLdEvents(html)
    stat.fetched    = ldEvents.length

    const yesterday = new Date(Date.now() - 86_400_000)
    const events: Record<string, unknown>[] = []

    for (const ev of ldEvents) {
      const name = typeof ev['name'] === 'string' ? ev['name'].trim() : null
      if (!name) continue
      const startStr = typeof ev['startDate'] === 'string' ? ev['startDate'] : null
      if (!startStr) continue
      const startDt = new Date(startStr.length === 10 ? `${startStr}T12:00:00-07:00` : startStr)
      if (isNaN(startDt.getTime()) || startDt < yesterday) continue
      const endStr   = typeof ev['endDate'] === 'string' ? ev['endDate'] : null
      const endDt    = endStr ? new Date(endStr.length === 10 ? `${endStr}T23:59:00-07:00` : endStr) : null
      const evUrl    = typeof ev['url'] === 'string' ? ev['url'] : htmlUrl
      const locObj   = ev['location'] as Record<string, unknown> | undefined
      const locName  = typeof locObj?.['name'] === 'string' ? locObj['name'] as string : null
      const imgRaw   = ev['image'] as string | Record<string, unknown> | undefined
      const imgUrl   = typeof imgRaw === 'string' ? imgRaw
        : typeof (imgRaw as Record<string, unknown> | undefined)?.['url'] === 'string'
          ? (imgRaw as Record<string, unknown>)['url'] as string : null
      const slug     = evUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 80)
      const body     = name.toLowerCase()
      const tags     = ['community']
      if (/free|no cost/i.test(body)) tags.push('free')
      if (/outdoor|waterfront|plaza|street/i.test(body)) tags.push('outdoor')

      events.push({
        title:           name.slice(0, 200),
        description:     typeof ev['description'] === 'string' ? (ev['description'] as string).slice(0, 500) : null,
        category:        'events',
        subcategory:     categorizeEvent(name),
        location_name:   locName ?? 'Old Sacramento Waterfront',
        address:         '1002 2nd St, Sacramento, CA 95814',
        city:            'Sacramento',
        region:          'sacramento',
        latitude:        DEFAULT_LAT,
        longitude:       DEFAULT_LNG,
        start_time:      startDt.toISOString(),
        end_time:        endDt && !isNaN(endDt.getTime()) ? endDt.toISOString() : null,
        external_link:   evUrl,
        flyer_image_url: imgUrl,
        source:          'old-sacramento',
        source_type:     'old-sacramento',
        source_url:      evUrl,
        external_id:     `old-sacramento-${slug}`,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Old Sacramento fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 12: Crocker Art Museum (Next.js __NEXT_DATA__ JSON) ───────────────

async function fetchCrockerMuseum(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://www.crockerart.org/events/'
  const overrides = {
    location_name: 'Crocker Art Museum',
    address:       '216 O St, Sacramento, CA 95814',
    city:          'Sacramento',
    region:        'sacramento',
    latitude:      38.5797,
    longitude:     -121.5089,
  }
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) { stat.errors.push(`Crocker Museum HTTP ${res.status}`); return [] }
    const html = await res.text()

    // Next.js embeds server state in <script id="__NEXT_DATA__" type="application/json">
    const ndMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/)
    if (!ndMatch) { stat.errors.push('Crocker Museum: __NEXT_DATA__ not found'); return [] }

    let ndData: Record<string, unknown>
    try { ndData = JSON.parse(ndMatch[1].trim()) }
    catch { stat.errors.push('Crocker Museum: __NEXT_DATA__ parse error'); return [] }

    // Path: props → pageProps → days → [{ date, items: [event, ...] }]
    const pageProps = (ndData['props'] as Record<string, unknown>)?.['pageProps'] as Record<string, unknown> | undefined
    const days      = Array.isArray(pageProps?.['days']) ? (pageProps!['days'] as unknown[]) : []
    if (days.length === 0) {
      stat.errors.push('Crocker Museum: no days array in __NEXT_DATA__')
      return []
    }

    const yesterday = new Date(Date.now() - 86_400_000)
    const events: Record<string, unknown>[] = []
    let totalItems = 0

    for (const day of days) {
      const d     = day as Record<string, unknown>
      const items = Array.isArray(d['items']) ? (d['items'] as unknown[]) : []
      totalItems += items.length

      for (const raw of items) {
        const ev = raw as Record<string, unknown>
        const title = typeof ev['title'] === 'string' ? ev['title'].trim() : null
        if (!title) continue

        const perfDateStr = typeof ev['PerformanceDate'] === 'string' ? ev['PerformanceDate'] : null
        if (!perfDateStr) continue
        const startDt = new Date(perfDateStr)
        if (isNaN(startDt.getTime()) || startDt < yesterday) continue

        const slug    = typeof ev['slug'] === 'string' ? ev['slug'] : null
        const perfId  = typeof ev['PerformanceId'] === 'number' ? (ev['PerformanceId'] as number) : null
        const evUrl   = slug ? `https://www.crockerart.org/events/${slug}` : url

        // Stable ID: prefer numeric PerformanceId, fall back to slug
        const idKey    = perfId != null ? String(perfId) : (slug ?? title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40))
        const external_id = `crocker-museum-${idKey}`

        const desc    = typeof ev['description'] === 'string' ? (ev['description'] as string).slice(0, 500) : null
        const thumbObj = ev['thumbnail'] as Record<string, unknown> | undefined
        const imgUrl  = typeof thumbObj?.['url'] === 'string' ? thumbObj['url'] as string : null

        const body    = (title + ' ' + (desc ?? '')).toLowerCase()
        const tags    = ['community']
        if (/free|no cost|complimentary/i.test(body)) tags.push('free')
        if (/workshop|lab|class|studio/i.test(body)) tags.push('academic-lecture')

        events.push({
          title:           title.slice(0, 200),
          description:     desc,
          category:        'events',
          subcategory:     categorizeEvent(title, desc ?? ''),
          start_time:      startDt.toISOString(),
          end_time:        null,
          external_link:   evUrl,
          flyer_image_url: imgUrl,
          source:          'crocker-museum',
          source_type:     'crocker-museum',
          source_url:      evUrl,
          external_id,
          tags,
          last_seen_at:    new Date().toISOString(),
          ...overrides,
        })
      }
    }

    stat.fetched = totalItems
    stat.parsed  = events.length
    return events
  } catch (err) {
    stat.errors.push(`Crocker Museum fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 11: Woodland City (CivicPlus ICS) ─────────────────────────────────

async function fetchWoodlandCity(stat: SourceStat): Promise<Record<string, unknown>[]> {
  // CivicPlus iCalendar feed — cityofwoodland.gov general city calendar
  const url = 'https://www.cityofwoodland.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar'
  // Woodland city center (E Main St)
  const DEFAULT_LAT = 38.6785
  const DEFAULT_LNG = -121.7732
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, text/plain, */*' },
    })
    if (!res.ok) { stat.errors.push(`Woodland City HTTP ${res.status}`); return [] }
    const icsText = await res.text()
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      stat.errors.push('Woodland City: response is not ICS (missing BEGIN:VCALENDAR)')
      return []
    }
    const icsEvents = parseICS(icsText)
    stat.fetched = icsEvents.length

    const events: Record<string, unknown>[] = []
    for (const ev of icsEvents) {
      if (!ev.dtstart) continue
      const external_id = `woodland-city-${icsUidToSlug(ev.uid)}`
      const body = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
      const tags = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')
      if (/outdoor|park|garden|trail|splash/i.test(body)) tags.push('outdoor')

      const locRaw  = ev.location && ev.location !== '-' ? ev.location : null
      const locName = locRaw ?? 'Woodland, CA'
      const address = locRaw ? `${locRaw}, Woodland, CA` : 'Woodland, CA 95695'

      events.push({
        title:           ev.summary.slice(0, 200),
        description:     ev.description ?? null,
        category:        'events',
        subcategory:     categorizeEvent(ev.summary, ev.description ?? ''),
        location_name:   locName,
        address,
        city:            'Woodland',
        region:          'woodland',
        latitude:        DEFAULT_LAT,
        longitude:       DEFAULT_LNG,
        start_time:      ev.dtstart.toISOString(),
        end_time:        ev.dtend?.toISOString() ?? null,
        external_link:   ev.url ?? 'https://www.cityofwoodland.gov/calendar.aspx',
        flyer_image_url: null,
        source:          'woodland-city',
        source_type:     'woodland-city',
        source_url:      ev.url ?? url,
        external_id,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Woodland City fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 11: Meetup — Sacramento Area (JSON-LD) ────────────────────────────

async function fetchMeetupSacramento(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url = 'https://www.meetup.com/find/?location=Sacramento%2C+CA&source=EVENTS'
  // Sacramento city center (Capitol Mall)
  const DEFAULT_LAT = 38.5816
  const DEFAULT_LNG = -121.4944
  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:          'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      25_000
    )
    if (!res.ok) { stat.errors.push(`Meetup HTTP ${res.status}`); return [] }
    const html = await res.text()

    const ldEvents = extractJsonLdEvents(html)
    stat.fetched = ldEvents.length

    const yesterday = new Date(Date.now() - 86_400_000)
    const events: Record<string, unknown>[] = []

    for (const ev of ldEvents) {
      // Skip online / virtual events — only want in-person
      const mode = typeof ev['eventAttendanceMode'] === 'string' ? ev['eventAttendanceMode'] : ''
      if (mode.toLowerCase().includes('online')) continue

      const name = typeof ev['name'] === 'string' ? ev['name'].trim() : null
      if (!name) continue

      const startStr = typeof ev['startDate'] === 'string' ? ev['startDate'] : null
      if (!startStr) continue
      const startDt = new Date(startStr)
      if (isNaN(startDt.getTime()) || startDt < yesterday) continue

      const endStr = typeof ev['endDate'] === 'string' ? ev['endDate'] : null
      const endDt  = endStr ? new Date(endStr) : null

      const evUrl = typeof ev['url'] === 'string' ? ev['url'] : url

      const locObj = ev['location'] as Record<string, unknown> | undefined
      // Skip virtual location objects
      if (locObj?.['@type'] === 'VirtualLocation') continue
      if (!locObj) continue

      const locName = typeof locObj['name'] === 'string' ? locObj['name'] : null
      const addrVal = locObj['address']
      const addrStr = typeof addrVal === 'string'
        ? addrVal
        : typeof (addrVal as Record<string, unknown> | undefined)?.['streetAddress'] === 'string'
          ? `${(addrVal as Record<string, unknown>)['streetAddress']}, ${(addrVal as Record<string, unknown>)['addressLocality'] ?? 'Sacramento'}, CA`
          : null

      // Extract and validate locality
      const meetupLocality = typeof addrVal === 'object' && addrVal !== null
        ? (typeof (addrVal as Record<string, unknown>)['addressLocality'] === 'string'
            ? (addrVal as Record<string, unknown>)['addressLocality'] as string
            : null)
        : null

      // Skip non-local events — only Sacramento/Davis area
      if (!isLocalLocality(meetupLocality)) { stat.skipped++; continue }
      // Also skip anything with a clearly non-CA state in the address
      if (hasNonCaliforniaState(addrStr)) { stat.skipped++; continue }

      const meetupCity = meetupLocality ?? 'Sacramento'

      // Stable ID from Meetup event URL: /events/DIGITS/
      const idMatch  = evUrl.match(/\/events\/(\d+)/)
      const evId     = idMatch?.[1] ?? icsUidToSlug(evUrl).slice(-20)

      const body = name.toLowerCase()
      const tags = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')

      events.push({
        title:           name.slice(0, 200),
        description:     typeof ev['description'] === 'string'
          ? (ev['description'] as string).slice(0, 500)
          : null,
        category:        'events',
        subcategory:     categorizeEvent(name),
        location_name:   locName ?? 'Sacramento, CA',
        address:         addrStr ?? 'Sacramento, CA',
        city:            meetupCity,
        region:          meetupCity === 'Davis' ? 'davis' : 'sacramento',
        latitude:        DEFAULT_LAT,
        longitude:       DEFAULT_LNG,
        start_time:      startDt.toISOString(),
        end_time:        endDt && !isNaN(endDt.getTime()) ? endDt.toISOString() : null,
        external_link:   evUrl,
        flyer_image_url: null,
        source:          'meetup-sacramento',
        source_type:     'meetup-sacramento',
        source_url:      evUrl,
        external_id:     `meetup-sacramento-${evId}`,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    stat.errors.push(`Meetup Sacramento fetch failed: ${(err as Error).message}`)
    return []
  }
}

// ── Source 12: Visit Yolo County (iCal) ──────────────────────────────────────
//
// visityoloco.com domain is defunct (DNS failure as of 2026-04).
// New canonical domain: visityolo.com — uses The Events Calendar WP plugin with
// a built-in iCal feed at /events/?ical=1 (same pattern as visitdavis.org).

async function fetchVisitYolo(stat: SourceStat): Promise<Record<string, unknown>[]> {
  const url         = 'https://visityolo.com/events/?ical=1'
  const DEFAULT_LAT = 38.6785  // Yolo County centre (between Woodland and Davis)
  const DEFAULT_LNG = -121.7732
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA, Accept: 'text/calendar, text/plain' },
    })
    if (!res.ok) {
      // Optional source — record but don't treat as hard failure
      stat.errors.push(`Visit Yolo HTTP ${res.status} — optional source, skipping`)
      return []
    }
    const icsText = await res.text()
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      stat.errors.push('Visit Yolo: response is not a valid iCal feed — optional source')
      return []
    }

    const icsEvents = parseICS(icsText)
    stat.fetched = icsEvents.length

    const yesterday = new Date(Date.now() - 86_400_000)
    const events: Record<string, unknown>[] = []

    for (const ev of icsEvents) {
      if (!ev.dtstart || ev.dtstart < yesterday) continue

      const external_id = `visit-yolo-${icsUidToSlug(ev.uid)}`
      const locStr      = ev.location ?? ''
      const body        = (ev.summary + ' ' + (ev.description ?? '')).toLowerCase()
      const tags        = ['community']
      if (/free|no cost|complimentary/i.test(body)) tags.push('free')
      if (/outdoor|winery|farm|harvest|trail|park/i.test(body)) tags.push('outdoor')

      // Best-effort city from location field
      const cityMatch = locStr.match(/\b(Davis|Woodland|Sacramento|West Sacramento|Winters|Dixon|Clarksburg|Capay)\b/i)
      const city      = cityMatch?.[1] ?? 'Woodland'
      const region    = city.toLowerCase() === 'davis' ? 'davis'
        : city.toLowerCase() === 'sacramento' ? 'sacramento'
        : 'woodland'

      events.push({
        title:           ev.summary.slice(0, 200),
        description:     ev.description ?? null,
        category:        'events',
        subcategory:     categorizeEvent(ev.summary, ev.description ?? ''),
        location_name:   locStr || `${city}, CA`,
        address:         locStr || `${city}, CA`,
        city,
        region,
        latitude:        DEFAULT_LAT,
        longitude:       DEFAULT_LNG,
        start_time:      ev.dtstart.toISOString(),
        end_time:        ev.dtend?.toISOString() ?? null,
        external_link:   ev.url ?? 'https://visityolo.com/events/',
        flyer_image_url: null,
        source:          'visit-yolo',
        source_type:     'visit-yolo',
        source_url:      ev.url ?? url,
        external_id,
        tags,
        last_seen_at:    new Date().toISOString(),
      })
    }
    stat.parsed = events.length
    return events
  } catch (err) {
    // Mark as optional — nice-to-have, not critical
    stat.errors.push(`Visit Yolo fetch failed (optional source): ${(err as Error).message}`)
    return []
  }
}

// ── Ingestion log helper ──────────────────────────────────────────────────────

/**
 * Derive per-source status:
 *  - blocked/empty sources that pushed errors but parsed nothing → 'failed'
 *  - sources with zero failed rows → 'success'
 *  - some rows failed but some succeeded → 'partial'
 *  - everything failed → 'failed'
 */
function resolveStatus(stat: SourceStat, fatalError?: string): 'success' | 'partial' | 'failed' {
  if (fatalError) return 'failed'
  // WAF-blocked / deprecated / domain-dead — expected behaviour, not a failure
  if (stat.blocked) return 'success'
  // Source returned errors and nothing was parsed/inserted/updated → truly failed
  if (stat.errors.length > 0 && stat.parsed === 0 && stat.inserted === 0 && stat.updated === 0) return 'failed'
  if (stat.failed === 0) return 'success'
  if (stat.inserted > 0 || stat.updated > 0) return 'partial'
  return 'failed'
}

/**
 * Populate no_insert_reason when inserted === 0 so the admin can see why.
 * Call this AFTER upsertEvents has run.
 */
function setNoInsertReason(stat: SourceStat): void {
  if (stat.inserted > 0) return  // has inserts — no explanation needed
  if (stat.no_insert_reason) return  // already set by the fetch function — preserve it
  if (stat.errors.length > 0 && stat.parsed === 0) {
    stat.no_insert_reason = stat.errors[0] ?? 'source blocked or empty'
  } else if (stat.parsed === 0) {
    stat.no_insert_reason = 'source returned no upcoming events'
  } else if (stat.updated > 0) {
    stat.no_insert_reason = `all ${stat.parsed} events already in DB (${stat.updated} updated)`
  } else if (stat.skipped > 0) {
    stat.no_insert_reason = `all ${stat.skipped} events skipped (duplicate or deleted)`
  } else {
    stat.no_insert_reason = 'parsed events but nothing inserted (check errors)'
  }
}

async function writeLog(
  supabase: ReturnType<typeof getServerSupabase>,
  source: string,
  stat: SourceStat,
  runAt: string,
  fatalError?: string
) {
  const status = resolveStatus(stat, fatalError)

  // Build a clear error_message for the admin dashboard:
  // Prefer explicit errors, then no_insert_reason, then null (clean run)
  const parts: string[] = []
  if (fatalError) {
    parts.push(fatalError)
  } else {
    if (stat.errors.length > 0) parts.push(...stat.errors.slice(0, 3))
    if (stat.no_insert_reason && stat.inserted === 0) parts.push(`ℹ ${stat.no_insert_reason}`)
  }
  const errorMsg = parts.length > 0 ? parts.join(' | ') : null

  const { error } = await supabase.from('ingestion_logs').insert({
    run_at:         runAt,
    source,
    inserted_count: stat.inserted,
    updated_count:  stat.updated,
    skipped_count:  stat.skipped,
    failed_count:   stat.failed,
    total_parsed:   stat.parsed,
    status,
    error_message:  errorMsg,
  })

  if (error) {
    // Table may not exist yet — warn but don't crash the ingestion
    console.warn(`[cron/ingest] failed to write ingestion_log for ${source}:`, error.message)
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const secret   = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase   = getServerSupabase()
  const runAt      = new Date().toISOString()
  const rejections: RejectionEntry[] = []

  /**
   * Filter an event array through isLocalEvent() before upsert.
   * Rejected events are logged to `rejections` for the response.
   * Also increments `stat.skipped` for each rejected event.
   */
  function localFilter(
    evs:        Record<string, unknown>[],
    sourceType: string,
    stat:       SourceStat,
  ): Record<string, unknown>[] {
    return evs.filter((ev) => {
      const pass = isLocalEvent(ev, sourceType, rejections)
      if (!pass) stat.skipped++
      return pass
    })
  }

  const makeStat = (): SourceStat => ({
    fetched: 0, parsed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
    errors: [], no_insert_reason: null, blocked: false,
  })

  const stats = {
    ucd_library:        makeStat(),
    mondavi:            makeStat(),
    davis_downtown:     makeStat(),
    eventbrite_davis:   makeStat(),
    visit_davis:        makeStat(),
    ucd_main:           makeStat(),
    ucd_athletics:      makeStat(),
    river_cats:         makeStat(),
    old_sacramento:     makeStat(),
    crocker_museum:     makeStat(),
    woodland_city:      makeStat(),
    meetup_sacramento:  makeStat(),
    visit_yolo:         makeStat(),
    // WAF-blocked — kept in stats so they appear in logs with clear reason
    arboretum:          makeStat(),
    manetti:            makeStat(),
    ucd_affairs:        makeStat(),
  }

  try {
    // ── Phase 1: Fetch all sources in parallel ──────────────────────────────
    // Promise.allSettled ensures one failure never cancels the others.
    const [
      libraryEvents, mondaviEvents, davisDowntownEvents,
      eventbriteEvents, visitDavisEvents, ucdEvents,
      athleticsEvents, riverCatsEvents, oldSacEvents,
      crockerEvents, woodlandEvents, meetupEvents, visitYoloEvents,
      arboretumEvents, manettiEvents, affairsEvents,
    ] = await Promise.allSettled([
      fetchLibrary(stats.ucd_library),
      fetchMondavi(stats.mondavi),
      fetchDavisDowntown(stats.davis_downtown),
      fetchEventbriteDavis(stats.eventbrite_davis),
      fetchVisitDavis(stats.visit_davis),
      fetchUCDMain(stats.ucd_main),
      fetchUCDAthleticsEvents(stats.ucd_athletics),
      fetchRiverCats(stats.river_cats),
      fetchOldSacramento(stats.old_sacramento),
      fetchCrockerMuseum(stats.crocker_museum),
      fetchWoodlandCity(stats.woodland_city),
      fetchMeetupSacramento(stats.meetup_sacramento),
      fetchVisitYolo(stats.visit_yolo),
      fetchArboretum(stats.arboretum),
      fetchManettiShrem(stats.manetti),
      fetchUCDStudentAffairs(stats.ucd_affairs),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : [])))

    // ── Phase 2: Locality filter → Upsert to Supabase ───────────────────────
    // Every event array is run through isLocalEvent() before upsert.
    // Stamp all passing events as approved (ingested sources are trusted).
    const stamp = (evs: Record<string, unknown>[]) =>
      evs.map((e) => ({ ...e, last_seen_at: runAt, status: 'approved' }))

    const lf = localFilter  // shorthand

    await upsertEvents(supabase, stamp(lf(libraryEvents,       'ucd-library',         stats.ucd_library)),       'ucd-library',         stats.ucd_library)
    await upsertEvents(supabase, stamp(lf(mondaviEvents,       'mondavi',             stats.mondavi)),            'mondavi',             stats.mondavi)
    await upsertEvents(supabase, stamp(lf(davisDowntownEvents, 'davis-downtown',      stats.davis_downtown)),     'davis-downtown',      stats.davis_downtown)
    await upsertEvents(supabase, stamp(lf(eventbriteEvents,    'eventbrite-davis',    stats.eventbrite_davis)),   'eventbrite-davis',    stats.eventbrite_davis)
    await upsertEvents(supabase, stamp(lf(visitDavisEvents,    'visit-davis',         stats.visit_davis)),        'visit-davis',         stats.visit_davis)
    await upsertEvents(supabase, stamp(lf(ucdEvents,           'ucd-website',         stats.ucd_main)),           'ucd-website',         stats.ucd_main)
    await upsertEvents(supabase, stamp(lf(athleticsEvents,     'ucd-athletics',       stats.ucd_athletics)),      'ucd-athletics',       stats.ucd_athletics)
    await upsertEvents(supabase, stamp(lf(riverCatsEvents,     'river-cats',          stats.river_cats)),         'river-cats',          stats.river_cats)
    await upsertEvents(supabase, stamp(lf(oldSacEvents,        'old-sacramento',      stats.old_sacramento)),     'old-sacramento',      stats.old_sacramento)
    await upsertEvents(supabase, stamp(lf(crockerEvents,       'crocker-museum',      stats.crocker_museum)),     'crocker-museum',      stats.crocker_museum)
    await upsertEvents(supabase, stamp(lf(woodlandEvents,      'woodland-city',       stats.woodland_city)),      'woodland-city',       stats.woodland_city)
    await upsertEvents(supabase, stamp(lf(meetupEvents,        'meetup-sacramento',   stats.meetup_sacramento)),  'meetup-sacramento',   stats.meetup_sacramento)
    await upsertEvents(supabase, stamp(lf(visitYoloEvents,     'visit-yolo',          stats.visit_yolo)),         'visit-yolo',          stats.visit_yolo)
    await upsertEvents(supabase, stamp(lf(arboretumEvents,     'ucd-arboretum',       stats.arboretum)),          'ucd-arboretum',       stats.arboretum)
    await upsertEvents(supabase, stamp(lf(manettiEvents,       'manetti-shrem',       stats.manetti)),            'manetti-shrem',       stats.manetti)
    await upsertEvents(supabase, stamp(lf(affairsEvents,       'ucd-student-affairs', stats.ucd_affairs)),        'ucd-student-affairs', stats.ucd_affairs)

    // ── Phase 2.5: Soft-delete existing athletics away games ─────────────────
    // Away games that were ingested before locality filtering was added have
    // latitude = null (home games always have coordinates). Safe to remove them.
    try {
      const { data: awayGames } = await supabase
        .from('items')
        .select('id')
        .eq('source_type', 'ucd-athletics')
        .is('latitude', null)
        .is('deleted_at', null)
      if (awayGames && awayGames.length > 0) {
        const ids = awayGames.map((r: { id: string }) => r.id)
        await supabase
          .from('items')
          .update({ deleted_at: runAt })
          .in('id', ids)
        console.log(`[cron/ingest] soft-deleted ${ids.length} athletics away game(s)`)
      }
    } catch (cleanupErr) {
      console.warn('[cron/ingest] away-game cleanup failed:', (cleanupErr as Error).message)
    }

    // ── Phase 3: Annotate zero-insert sources before logging ────────────────
    for (const stat of Object.values(stats)) setNoInsertReason(stat)

    // ── Phase 4: Write one log row per source ───────────────────────────────
    await Promise.all([
      writeLog(supabase, 'ucd-library',         stats.ucd_library,       runAt),
      writeLog(supabase, 'mondavi',             stats.mondavi,           runAt),
      writeLog(supabase, 'davis-downtown',      stats.davis_downtown,    runAt),
      writeLog(supabase, 'eventbrite-davis',    stats.eventbrite_davis,  runAt),
      writeLog(supabase, 'visit-davis',         stats.visit_davis,       runAt),
      writeLog(supabase, 'ucd-website',         stats.ucd_main,          runAt),
      writeLog(supabase, 'ucd-athletics',       stats.ucd_athletics,     runAt),
      writeLog(supabase, 'river-cats',          stats.river_cats,        runAt),
      writeLog(supabase, 'old-sacramento',      stats.old_sacramento,    runAt),
      writeLog(supabase, 'crocker-museum',      stats.crocker_museum,    runAt),
      writeLog(supabase, 'woodland-city',       stats.woodland_city,     runAt),
      writeLog(supabase, 'meetup-sacramento',   stats.meetup_sacramento, runAt),
      writeLog(supabase, 'visit-yolo',          stats.visit_yolo,        runAt),
      writeLog(supabase, 'ucd-arboretum',       stats.arboretum,         runAt),
      writeLog(supabase, 'manetti-shrem',       stats.manetti,           runAt),
      writeLog(supabase, 'ucd-student-affairs', stats.ucd_affairs,       runAt),
    ])

    // ── Summary ─────────────────────────────────────────────────────────────
    const sum = (key: keyof Pick<SourceStat, 'inserted' | 'updated' | 'skipped' | 'failed'>) =>
      Object.values(stats).reduce((acc, s) => acc + s[key], 0)

    // Tally rejections by reason for the response
    const rejByReason: Record<string, number> = {}
    for (const r of rejections) {
      rejByReason[r.reason] = (rejByReason[r.reason] ?? 0) + 1
    }

    const summary = {
      inserted:       sum('inserted'),
      updated:        sum('updated'),
      skipped:        sum('skipped'),
      failed:         sum('failed'),
      sources_active: 13,  // healthy + weak sources (6 original + 7 new)
      sources_total:  Object.keys(stats).length,
    }

    const rejected_summary = {
      total:     rejections.length,
      by_reason: rejByReason,
      samples:   rejections.slice(0, 20).map((r) => ({
        title:    r.title.slice(0, 80),
        location: r.location.slice(0, 60),
        reason:   r.reason,
      })),
    }

    const output = { sources: stats, summary, rejected: rejected_summary }
    console.log('[cron/ingest]', JSON.stringify({ summary, rejected: { total: rejections.length, by_reason: rejByReason } }))
    return NextResponse.json(output)

  } catch (err) {
    const msg = (err as Error).message
    console.error('[cron/ingest] fatal error:', msg)

    await Promise.allSettled(
      Object.keys(stats).map((src) =>
        writeLog(supabase, src, stats[src as keyof typeof stats], runAt, msg)
      )
    )

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
