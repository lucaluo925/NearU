import { log } from './logger.mjs'

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'AggieMap/1.0 (aggiemap.app)'

// Respect Nominatim's 1 req/sec policy
let lastRequestAt = 0
async function rateLimit() {
  const wait = 1100 - (Date.now() - lastRequestAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

/**
 * Geocode an address string → { latitude, longitude } or null.
 * Uses OpenStreetMap Nominatim (free, no API key).
 */
export async function geocode(address) {
  if (!address) return null
  try {
    await rateLimit()
    const params = new URLSearchParams({
      q: address,
      format: 'json',
      limit: '1',
      countrycodes: 'us',
    })
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    })
    if (!res.ok) {
      log.warn(`Geocode HTTP ${res.status} for: ${address}`)
      return null
    }
    const data = await res.json()
    if (!data.length) {
      log.skip(`Geocode: no result for "${address}"`)
      return null
    }
    return {
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
    }
  } catch (err) {
    log.warn(`Geocode failed for "${address}": ${err.message}`)
    return null
  }
}
