/**
 * UC Davis Library Events
 *
 * Source: Localist RSS feed at events.library.ucdavis.edu
 * Format: RSS 2.0 with dc:date (ISO 8601), geo coords, media:content images
 *
 * Feed URL: https://events.library.ucdavis.edu/calendar/1.xml
 * Typically returns 30–50 upcoming events.
 */

import { log } from '../lib/logger.mjs'
import { resolveCampusLocation } from '../lib/campus-buildings.mjs'

const FEED_URL = 'https://events.library.ucdavis.edu/calendar/1.xml'
const UA = 'Mozilla/5.0 (compatible; AggieMap/1.0; +https://aggiemap.app)'

function categorize(title, category) {
  const t = (title + ' ' + (category ?? '')).toLowerCase()
  if (/career|job|recruit|intern|networking|professional|resume/.test(t)) return 'career-networking'
  if (/concert|music|perform|theatre|theater|exhibit|art|reading|author/.test(t)) return 'arts-music'
  if (/volunteer|service|community|charity/.test(t)) return 'volunteer'
  if (/club|org|association|society|group/.test(t)) return 'club-student-org'
  // default for library: academic
  return 'academic-lecture'
}

/** Extract text from XML tag, handling CDATA and plain text */
function xmlGet(xml, tag) {
  const escaped = tag.replace(/:/g, ':') // keep namespace intact
  const pattern = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${escaped}>`, 'i'
  )
  const m = xml.match(pattern)
  return m ? (m[1] ?? m[2] ?? '').trim() : null
}

/** Extract an attribute value from an XML self-closing or opening tag */
function xmlAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}=['"]([^'"]+)['"]`))
  return m ? m[1] : null
}

function parseItem(itemXml) {
  // Title — Localist prefixes with "Apr 6, 2026: "
  const rawTitle = xmlGet(itemXml, 'title')
  if (!rawTitle) return null
  const decodeEntities = (s) => s
    .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  const title = decodeEntities(rawTitle.replace(/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}:\s*/, '').trim())
  if (!title) return null

  // Date — dc:date is ISO 8601 (most reliable field in this feed)
  const dcDate = xmlGet(itemXml, 'dc:date')
  if (!dcDate) {
    log.warn(`  [skip] no dc:date for "${title.slice(0, 60)}"`)
    return null
  }
  const startDt = new Date(dcDate)
  if (isNaN(startDt.getTime())) {
    log.warn(`  [skip] invalid date "${dcDate}" for "${title.slice(0, 60)}"`)
    return null
  }
  if (startDt < new Date(Date.now() - 86400_000)) {
    return null // silently skip past events
  }

  const link      = xmlGet(itemXml, 'link')
  const imageUrl  = xmlAttr(itemXml, 'media:content', 'url') ?? null
  const category  = xmlGet(itemXml, 'category') ?? ''
  const guid      = xmlGet(itemXml, 'guid') ?? ''
  const latStr    = xmlGet(itemXml, 'geo:lat')
  const lngStr    = xmlGet(itemXml, 'geo:long')

  const lat = latStr ? parseFloat(latStr) : null
  const lng = lngStr ? parseFloat(lngStr) : null

  // external_id from URL slug, fallback to GUID
  const slugMatch = link?.match(/\/event\/([^/?#]+)/)
  const slug = slugMatch?.[1] ?? null
  const external_id = slug
    ? `ucd-library-${slug}`
    : `ucd-library-${guid.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(-40)}`

  const desc = xmlGet(itemXml, 'description') ?? ''
  const isVirtual = /virtual|zoom|online/i.test(title + ' ' + desc)

  const resolved = (!isVirtual && lat && lng)
    ? { address: 'Peter J. Shields Library, UC Davis, Davis, CA 95616', latitude: lat, longitude: lng }
    : resolveCampusLocation('shields library')

  const tags = ['student-friendly']
  if (/free|no cost|complimentary/i.test(desc + ' ' + rawTitle)) tags.push('free')
  if (isVirtual) tags.push('virtual')

  return {
    title: title.slice(0, 200),
    description: null,
    category: 'events',
    subcategory: categorize(title, category),
    location_name: isVirtual ? 'Virtual / Zoom' : 'Shields Library',
    address: isVirtual ? 'Online' : (resolved?.address ?? 'Peter J. Shields Library, UC Davis, Davis, CA 95616'),
    city: 'Davis',
    region: isVirtual ? 'online' : 'on-campus',
    latitude: isVirtual ? null : (resolved?.latitude ?? 38.5403),
    longitude: isVirtual ? null : (resolved?.longitude ?? -121.7487),
    start_time: startDt.toISOString(),
    end_time: null,
    external_link: link ?? FEED_URL,
    flyer_image_url: imageUrl,
    source: 'ucd-library',
    source_type: 'ucd-library',
    source_url: link ?? FEED_URL,
    external_id,
    tags,
  }
}

/** Fetch and parse all upcoming UC Davis Library events from the Localist RSS feed. */
export async function fetchLibraryEvents() {
  log.info(`Fetching UC Davis Library events from ${FEED_URL}`)

  let xml
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml' },
      signal: AbortSignal.timeout(20_000),
    })
    log.info(`  → HTTP ${res.status} (${res.headers.get('content-type')})`)
    if (!res.ok) {
      log.error(`Library feed returned HTTP ${res.status}`)
      return []
    }
    xml = await res.text()
  } catch (err) {
    log.error(`Library fetch failed: ${err.message}`)
    return []
  }

  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  log.info(`  → Found ${itemBlocks.length} items in feed`)

  if (!itemBlocks.length) {
    log.warn('  → No items found — feed structure may have changed')
    return []
  }

  const items = itemBlocks.map(parseItem).filter(Boolean)
  log.info(`Library: ${items.length} usable events (from ${itemBlocks.length} items)`)
  return items
}
