#!/usr/bin/env node
/**
 * Fix location data for existing Supabase records that have:
 *   (a) a specific location_name but missing lat/lng
 *   (b) a generic "Shields Ave" address despite having a known location_name
 *
 * Run with:
 *   node scripts/ingest/fix-locations.mjs
 */

import { supabase } from './lib/supabase.mjs'
import { geocode } from './lib/geocode.mjs'
import { resolveCampusLocation } from './lib/campus-buildings.mjs'
import { log } from './lib/logger.mjs'

const GENERIC_ADDRESSES = [
  '1 shields ave',
  'one shields ave',
]

function isGenericAddress(addr) {
  if (!addr) return true
  const n = addr.toLowerCase().trim()
  return GENERIC_ADDRESSES.some((g) => n.startsWith(g))
}

async function main() {
  log.section('Aggie Map — Fix Locations')

  // Fetch all non-deleted items
  const { data: items, error } = await supabase
    .from('items')
    .select('id, title, address, latitude, longitude, location_name')
    .is('deleted_at', null)

  if (error) { log.error(`Fetch failed: ${error.message}`); process.exit(1) }
  log.info(`Fetched ${items.length} items`)

  let updated = 0
  let geocoded = 0
  let skipped = 0
  let failed = 0

  for (const item of items) {
    const needsCoords = item.latitude == null || item.longitude == null
    const hasGenericAddr = isGenericAddress(item.address)

    // Skip if coords are present AND address is already specific
    if (!needsCoords && !hasGenericAddr) { skipped++; continue }

    const patch = {}

    // Try the campus building map first (covers location_name)
    const resolved = resolveCampusLocation(item.location_name)

    if (resolved) {
      if (hasGenericAddr) patch.address = resolved.address
      if (needsCoords) {
        patch.latitude = resolved.latitude
        patch.longitude = resolved.longitude
      }
      log.ok(`  Building map: "${item.title.slice(0, 50)}" → ${resolved.address}`)
    } else if (needsCoords && item.address) {
      // Fall back to geocoding the existing address
      log.info(`  Geocoding: "${item.address}" for "${item.title.slice(0, 50)}"`)
      const coords = await geocode(item.address)
      if (coords) {
        patch.latitude = coords.latitude
        patch.longitude = coords.longitude
        geocoded++
        log.ok(`    → ${coords.latitude}, ${coords.longitude}`)
      } else {
        log.warn(`    → geocode failed, skipping`)
        skipped++
        continue
      }
    } else {
      // Generic address, no location_name match, no coords to geocode from
      if (needsCoords) {
        log.warn(`  No resolution for "${item.title.slice(0, 50)}" (loc="${item.location_name ?? 'none'}")`)
        skipped++
        continue
      }
      skipped++
      continue
    }

    if (Object.keys(patch).length === 0) { skipped++; continue }

    const { error: updateErr } = await supabase
      .from('items')
      .update(patch)
      .eq('id', item.id)

    if (updateErr) {
      log.error(`  Update failed for "${item.title}": ${updateErr.message}`)
      failed++
    } else {
      updated++
    }
  }

  log.section('Summary')
  console.log(`  Updated  : ${updated}`)
  console.log(`  Geocoded : ${geocoded} (used Nominatim fallback)`)
  console.log(`  Skipped  : ${skipped} (already good or unresolvable)`)
  console.log(`  Failed   : ${failed}`)
  console.log()
}

main().catch((err) => { log.error(err.message); process.exit(1) })
