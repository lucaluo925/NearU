/**
 * Local Davis / Sacramento Ingester
 *
 * Sources:
 *   1. Curated places JSON (scripts/ingest/data/places.json)
 *      Restaurants, cafes, study spots, parks, and landmarks in Davis area.
 *      Maintained manually — add entries to the JSON file.
 *
 *   2. RSS / ICS feeds (add new ones in the `FEEDS` array below)
 *      Currently empty — most City of Davis / Downtown RSS feeds return 403.
 *      Add working feeds when discovered.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { log } from '../lib/logger.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLACES_JSON = join(__dirname, '../data/places.json')

// ── RSS Feeds ───────────────────────────────────────────────────────────────
// Add working feeds here. Each entry: { url, defaults: { city, region, address, tags } }
// Feeds that return 403/404 are automatically skipped with a warning.
const FEEDS = [
  // Example (disabled — returns 403):
  // { url: 'https://www.cityofdavis.org/events/rss', defaults: { city: 'Davis', region: 'davis' } },
]

/**
 * Simple regex RSS parser — no dependencies.
 * Returns [] if feed is unavailable or malformed.
 */
async function parseRSS(url, defaults = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AggieMap/1.0 (aggiemap.app)', Accept: 'application/rss+xml, text/xml, */*' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      log.warn(`RSS ${url} → HTTP ${res.status} — skipping`)
      return []
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('xml') && !ct.includes('rss')) {
      log.warn(`RSS ${url} returned non-XML content-type: ${ct} — skipping`)
      return []
    }

    const xml = await res.text()
    const items = []
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []

    for (const block of itemMatches) {
      const title = (
        block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
        block.match(/<title>(.*?)<\/title>/)
      )?.[1]?.trim()

      const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim()
      const description = (
        block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ??
        block.match(/<description>(.*?)<\/description>/)
      )?.[1]
        ?.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)

      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim()

      if (!title || !link) continue
      let start_time = null
      if (pubDate) {
        const d = new Date(pubDate)
        if (!isNaN(d.getTime())) start_time = d.toISOString()
      }

      items.push({
        title,
        description: description ?? null,
        category: 'events',
        subcategory: 'campus-events',
        address: defaults.address ?? 'Davis, CA 95616',
        city: defaults.city ?? 'Davis',
        region: defaults.region ?? 'davis',
        latitude: null,
        longitude: null,
        start_time,
        end_time: null,
        external_link: link,
        flyer_image_url: null,
        source: 'local',
        source_type: 'local',
        source_url: link,
        external_id: link,
        tags: ['student-friendly', ...(defaults.tags ?? [])],
      })
    }

    log.info(`RSS ${url} → ${items.length} items`)
    return items
  } catch (err) {
    log.warn(`RSS parse failed for ${url}: ${err.message}`)
    return []
  }
}

/**
 * Load the curated places JSON and return items.
 * Items already have coordinates, so geocoding is skipped.
 */
function loadPlaces() {
  try {
    const raw = readFileSync(PLACES_JSON, 'utf8')
    const places = JSON.parse(raw)
    return places.map((p, i) => ({
      ...p,
      source: p.source ?? 'places-seed',
      source_type: p.source_type ?? 'places-seed',
      external_id: p.external_id ?? `place-${(p.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}-${i}`,
      tags: p.tags ?? [],
      external_link: p.external_link ?? null,
      start_time: p.start_time ?? null,
      end_time: p.end_time ?? null,
    }))
  } catch (err) {
    log.error(`Failed to load places.json: ${err.message}`)
    return []
  }
}

/** Main export: fetch all local items (places + RSS feeds). */
export async function fetchLocalEvents() {
  const results = []

  // ── Curated Places ─────────────────────────────────────────────────────────
  log.info('Loading curated Davis places...')
  const places = loadPlaces()
  log.info(`  → ${places.length} places loaded`)
  results.push(...places)

  // ── RSS Feeds ──────────────────────────────────────────────────────────────
  for (const { url, defaults } of FEEDS) {
    log.info(`Fetching RSS: ${url}`)
    const items = await parseRSS(url, defaults)
    results.push(...items)
  }

  log.info(`Local sources total: ${results.length} items`)
  return results
}
