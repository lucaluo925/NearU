/**
 * UC Davis Events Ingester
 *
 * Source: https://www.ucdavis.edu/events (Drupal server-rendered HTML)
 *
 * The old Localist JSON API (calendar.ucdavis.edu/api/2/events) was migrated
 * to a Drupal-based system and now returns HTML. This scraper parses the
 * rendered <article class="node--type-sf-event"> elements instead.
 *
 * If the page structure changes, events will gracefully fall to 0 (not crash).
 */

import { log } from '../lib/logger.mjs'
import { resolveCampusLocation } from '../lib/campus-buildings.mjs'

const EVENTS_URL = 'https://www.ucdavis.edu/events'
const UA = 'Mozilla/5.0 (compatible; AggieMap/1.0; +https://aggiemap.app)'

/**
 * Parse a date/time string from the UCD events page.
 *
 * The <time> element contains inner HTML spans, e.g.:
 *   "Apr 5, 2024 - Dec 20, 2050 <span class="date-separator">@</span>
 *    <span class="date-time">8:00am - 8:00pm</span>"
 *
 * Supports:
 *   "Apr 5, 2026 @ 8:00am - 8:00pm"                (single day)
 *   "Apr 5, 2026 - May 3, 2026 @ 8:00am"            (date range)
 *   "Apr 5, 2024 - Dec 20, 2050 @ 8:00am - 8:00pm"  (ongoing multi-year)
 *
 * Returns { start_time, end_time } as ISO strings, or null if fully expired.
 */
function parseDatetime(raw, title) {
  if (!raw) return { start_time: null, end_time: null }

  // Strip all HTML tags, then collapse whitespace
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  // Split on "@" to separate date part from time part
  const atIdx = text.indexOf('@')
  let datePart, timePart
  if (atIdx !== -1) {
    datePart = text.slice(0, atIdx).trim()
    timePart = text.slice(atIdx + 1).trim()
  } else {
    datePart = text
    timePart = ''
  }

  // Date part: "Apr 5, 2026" or "Apr 5, 2026 - May 3, 2026"
  // Split on " - " only where the right side starts with a month abbreviation
  const dateParts = datePart.split(/\s*-\s*(?=[A-Z][a-z]{2}\s)/).map((s) => s.trim())
  const startDate = dateParts[0]
  const endDate   = dateParts[1] ?? null

  // Normalize "8:00am" → "8:00 AM" so JS Date can parse it
  const normTime = (t) => t ? t.replace(/^(\d{1,2}:\d{2})(am|pm)$/i, (_, hm, ap) => `${hm} ${ap.toUpperCase()}`) : null

  // Time part: "8:00am - 8:00pm" or "7:00pm" or ""
  const times = timePart.split(/\s*-\s*/).map((s) => s.trim()).filter(Boolean)
  const startTime = normTime(times[0] ?? null)
  const endTime   = normTime(times[1] ?? null)

  if (!startDate) {
    log.warn(`  [skip] no start date parsed from: "${text}" (${title?.slice(0, 40)})`)
    return { start_time: null, end_time: null }
  }

  try {
    const startStr = startTime ? `${startDate} ${startTime}` : startDate
    const startDt  = new Date(startStr)
    if (isNaN(startDt.getTime())) {
      log.warn(`  [skip] unparseable date: "${startStr}" (${title?.slice(0, 40)})`)
      return { start_time: null, end_time: null }
    }

    // Use end date for staleness check (ongoing events have future end dates)
    const endDateForCheck = endDate ?? startDate
    const endStr          = endTime ? `${endDateForCheck} ${endTime}` : endDateForCheck
    const endDt           = new Date(endStr)
    const validEnd        = !isNaN(endDt.getTime())

    const cutoff   = new Date(Date.now() - 86400_000)
    const expiryDt = validEnd ? endDt : startDt
    if (expiryDt < cutoff) {
      log.warn(`  [skip] expired: end="${endDateForCheck}" (${title?.slice(0, 40)})`)
      return null
    }

    const end_time = validEnd ? endDt.toISOString() : null
    return { start_time: startDt.toISOString(), end_time }
  } catch {
    return { start_time: null, end_time: null }
  }
}

/**
 * Best-effort category mapping from event title keywords.
 */
function categorize(title) {
  const t = title.toLowerCase()
  if (/career|job|recruit|intern|networking|professional/.test(t)) return 'career-networking'
  if (/lecture|seminar|colloquium|symposium|talk|workshop|conf/.test(t)) return 'academic-lecture'
  if (/concert|music|perform|theatre|theater|gallery|exhibit|art/.test(t)) return 'arts-music'
  if (/sport|game|match|tournament|athlet/.test(t)) return 'sports'
  if (/volunteer|service|community|charity/.test(t)) return 'volunteer'
  if (/club|org|association|society|meeting/.test(t)) return 'club-student-org'
  if (/picnic|party|social|mixer|reception|celebration/.test(t)) return 'social-party'
  return 'campus-events'
}

/**
 * Parse one <article> block from the HTML into a normalized item.
 * Returns null if the article is unparseable or the event is in the past.
 */
function parseArticle(block) {
  try {
    // URL slug from `about="/events/..."` attribute
    const slugMatch = block.match(/about="\/events\/([^"]+)"/)
    const slug = slugMatch?.[1] ?? null
    const eventUrl = slug ? `https://www.ucdavis.edu/events/${slug}` : EVENTS_URL

    // Title
    const titleMatch = block.match(/<span class="field field--name-title[^"]*">([\s\S]*?)<\/span>/)
    const title = titleMatch?.[1]?.trim().replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"') ?? null
    if (!title) return null

    // Date/time — pass title for better skip logging
    const timeMatch = block.match(/<time class="datetime">([\s\S]*?)<\/time>/)
    const rawTime = timeMatch?.[1]?.trim() ?? null
    if (!rawTime) {
      log.warn(`  [skip] no <time> element found for "${title?.slice(0, 60)}"`)
      return null
    }
    const parsed = parseDatetime(rawTime, title)
    if (parsed === null) return null // expired — already logged inside parseDatetime

    // Location
    const locMatch = block.match(/icon--location[^>]*>([\s\S]*?)<\/div>/)
    const locationName = locMatch?.[1]?.trim().replace(/<[^>]*>/g, '').trim() || null

    // Image
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/)
    let imageUrl = imgMatch?.[1] ?? null
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = `https://www.ucdavis.edu${imageUrl}`
    }

    const subcategory = categorize(title)
    const tags = ['student-friendly']
    if (/free|no cost|complimentary/i.test(block)) tags.push('free')
    if (/outdoor|outside|garden|arboretum|park/i.test(block)) tags.push('outdoor')

    // Resolve specific building address + coords from location_name.
    // Only fall back to generic "1 Shields Ave" if nothing resolves.
    const resolved = resolveCampusLocation(locationName)
    if (!resolved) {
      log.warn(`  ↳ No building match for location_name: "${locationName ?? '(none)'}" on event "${title.slice(0, 60)}"`)
    }

    return {
      title: title.slice(0, 200),
      description: null,
      category: 'events',
      subcategory,
      location_name: locationName,
      address: resolved?.address ?? '1 Shields Ave, Davis, CA 95616',
      city: 'Davis',
      region: 'on-campus',
      latitude: resolved?.latitude ?? null,
      longitude: resolved?.longitude ?? null,
      start_time: parsed.start_time,
      end_time: parsed.end_time,
      external_link: eventUrl,
      flyer_image_url: imageUrl,
      source: 'ucd-website',
      source_type: 'ucd-website',
      source_url: eventUrl,
      external_id: slug ?? title.toLowerCase().replace(/\s+/g, '-').slice(0, 100),
      tags,
    }
  } catch (err) {
    log.warn(`parseArticle error: ${err.message}`)
    return null
  }
}

/** Fetch and parse all upcoming UC Davis events from the website. */
export async function fetchUCDEvents() {
  log.info(`Fetching UC Davis events from ${EVENTS_URL}`)

  let html
  try {
    const res = await fetch(EVENTS_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    log.info(`  → HTTP ${res.status} (${res.headers.get('content-type')})`)
    if (!res.ok) {
      log.error(`UC Davis events page returned HTTP ${res.status}`)
      return []
    }
    html = await res.text()
  } catch (err) {
    log.error(`UC Davis fetch failed: ${err.message}`)
    return []
  }

  // Extract all <article ...> blocks
  const articleBlocks = html.match(/<article\b[^>]*class="[^"]*node--type-sf-event[^"]*"[^>]*>[\s\S]*?<\/article>/g) ?? []
  log.info(`  → Found ${articleBlocks.length} event article blocks`)

  if (!articleBlocks.length) {
    log.warn('  → No event articles found — page structure may have changed')
    return []
  }

  const items = articleBlocks.map(parseArticle).filter(Boolean)
  log.info(`UC Davis: ${items.length} usable events parsed (from ${articleBlocks.length} blocks)`)
  return items
}
