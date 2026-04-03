/**
 * UC Davis Arboretum Events
 *
 * Source: https://arboretum.ucdavis.edu/events (Drupal 10 SiteFarm)
 *
 * Uses the same Drupal SiteFarm HTML structure as ucdavis.edu/events,
 * with two key differences:
 *   - No `about` attribute on <article>; event slug in the title link href
 *   - Title in <h3 class="vm-teaser__title"> rather than a <span>
 *
 * Typically lists ~10 upcoming outdoor/garden events.
 */

import { log } from '../lib/logger.mjs'
import { resolveCampusLocation } from '../lib/campus-buildings.mjs'

const EVENTS_URL = 'https://arboretum.ucdavis.edu/events'
const BASE_URL   = 'https://arboretum.ucdavis.edu'
const UA = 'Mozilla/5.0 (compatible; AggieMap/1.0; +https://aggiemap.app)'

const ARBORETUM_DEFAULT = {
  address: 'UC Davis Arboretum, 448 La Rue Rd, Davis, CA 95616',
  latitude: 38.5305,
  longitude: -121.7536,
}

/**
 * Parse date/time from a Drupal SiteFarm <time> element.
 * Inner HTML contains spans: "Apr 1, 2026 <span>@</span> <span>3:00pm - 5:00pm</span>"
 */
function parseDatetime(raw, title) {
  if (!raw) return { start_time: null, end_time: null }

  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  const atIdx = text.indexOf('@')
  let datePart, timePart
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

  const normTime = (t) =>
    t ? t.replace(/^(\d{1,2}:\d{2})(am|pm)$/i, (_, hm, ap) => `${hm} ${ap.toUpperCase()}`) : null

  const times = timePart.split(/\s*-\s*/).map((s) => s.trim()).filter(Boolean)
  const startTime = normTime(times[0] ?? null)
  const endTime   = normTime(times[1] ?? null)

  if (!startDate) {
    log.warn(`  [skip] no start date from: "${text}" (${title?.slice(0, 40)})`)
    return { start_time: null, end_time: null }
  }

  try {
    const startStr = startTime ? `${startDate} ${startTime}` : startDate
    const startDt  = new Date(startStr)
    if (isNaN(startDt.getTime())) {
      log.warn(`  [skip] invalid date: "${startStr}" (${title?.slice(0, 40)})`)
      return { start_time: null, end_time: null }
    }

    const endDateForCheck = endDate ?? startDate
    const endStr  = endTime ? `${endDateForCheck} ${endTime}` : endDateForCheck
    const endDt   = new Date(endStr)
    const validEnd = !isNaN(endDt.getTime())

    const cutoff   = new Date(Date.now() - 86400_000)
    const expiryDt = validEnd ? endDt : startDt
    if (expiryDt < cutoff) {
      log.warn(`  [skip] expired end="${endDateForCheck}" (${title?.slice(0, 40)})`)
      return null
    }

    return {
      start_time: startDt.toISOString(),
      end_time: validEnd ? endDt.toISOString() : null,
    }
  } catch {
    return { start_time: null, end_time: null }
  }
}

function categorize(title) {
  const t = title.toLowerCase()
  if (/volunteer|weed|stewardship|restoration|service|cleanup/.test(t)) return 'volunteer'
  if (/concert|music|perform|folk|jazz|band|recital/.test(t)) return 'arts-music'
  if (/lecture|seminar|talk|tour|workshop|training/.test(t)) return 'academic-lecture'
  if (/yoga|fitness|meditation|wellness|run/.test(t)) return 'sports'
  return 'campus-events'
}

function parseArticle(block) {
  try {
    // Title: <h3 class="vm-teaser__title"><a href="...">Title Text</a></h3>
    const titleMatch = block.match(/<h3[^>]*vm-teaser__title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)
    const title = titleMatch?.[1]
      ?.replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
      .trim() ?? null
    if (!title) return null

    // URL: first href="/events/..." in the block
    const hrefMatch = block.match(/href="(\/events\/[^"]+)"/)
    const slug      = hrefMatch?.[1]?.replace(/^\/events\//, '') ?? null
    const eventUrl  = slug ? `${BASE_URL}/events/${slug}` : EVENTS_URL

    // Date/time
    const timeMatch = block.match(/<time class="datetime">([\s\S]*?)<\/time>/)
    const rawTime   = timeMatch?.[1]?.trim() ?? null
    if (!rawTime) {
      log.warn(`  [skip] no <time> element for "${title.slice(0, 60)}"`)
      return null
    }
    const parsed = parseDatetime(rawTime, title)
    if (parsed === null) return null

    // Location
    const locMatch    = block.match(/icon--location[^>]*>([\s\S]*?)<\/div>/)
    const locationName = locMatch?.[1]?.replace(/<[^>]*>/g, '').trim() || null

    // Image
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/)
    let imageUrl   = imgMatch?.[1] ?? null
    if (imageUrl && !imageUrl.startsWith('http')) imageUrl = `${BASE_URL}${imageUrl}`

    const subcategory = categorize(title)
    const tags = ['student-friendly', 'outdoor']
    if (/free|no cost/i.test(block)) tags.push('free')

    // Use building map if location_name matches something; otherwise default to Arboretum
    const resolved = resolveCampusLocation(locationName) ?? ARBORETUM_DEFAULT

    return {
      title: title.slice(0, 200),
      description: null,
      category: 'events',
      subcategory,
      location_name: locationName ?? 'UC Davis Arboretum',
      address: resolved.address,
      city: 'Davis',
      region: 'on-campus',
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      start_time: parsed.start_time,
      end_time: parsed.end_time,
      external_link: eventUrl,
      flyer_image_url: imageUrl,
      source: 'ucd-arboretum',
      source_type: 'ucd-arboretum',
      source_url: eventUrl,
      external_id: slug
        ? `ucd-arboretum-${slug}`
        : `ucd-arboretum-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      tags,
    }
  } catch (err) {
    log.warn(`parseArticle error: ${err.message}`)
    return null
  }
}

/** Fetch and parse all upcoming UC Davis Arboretum events. */
export async function fetchArboretumEvents() {
  log.info(`Fetching Arboretum events from ${EVENTS_URL}`)

  let html
  try {
    const res = await fetch(EVENTS_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    log.info(`  → HTTP ${res.status} (${res.headers.get('content-type')})`)
    if (!res.ok) {
      log.error(`Arboretum events page returned HTTP ${res.status}`)
      return []
    }
    html = await res.text()
  } catch (err) {
    log.error(`Arboretum fetch failed: ${err.message}`)
    return []
  }

  const articleBlocks = html.match(
    /<article\b[^>]*class="[^"]*node--type-sf-event[^"]*"[^>]*>[\s\S]*?<\/article>/g
  ) ?? []
  log.info(`  → Found ${articleBlocks.length} event articles`)

  if (!articleBlocks.length) {
    log.warn('  → No event articles found — page structure may have changed')
    return []
  }

  const items = articleBlocks.map(parseArticle).filter(Boolean)
  log.info(`Arboretum: ${items.length} usable events (from ${articleBlocks.length} blocks)`)
  return items
}
