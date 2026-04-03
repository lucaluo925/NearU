import { supabase } from './supabase.mjs'
import { geocode } from './geocode.mjs'
import { log } from './logger.mjs'

/**
 * Upsert a batch of normalized items into Supabase.
 * - Geocodes addresses where lat/lng are missing
 * - Updates last_seen_at on duplicate hits
 * - Skips soft-deleted records
 * Returns { inserted, updated, skipped, failed }
 */
export async function upsertItems(items, sourceType) {
  let inserted = 0, updated = 0, skipped = 0, failed = 0

  for (const raw of items) {
    try {
      // Geocode if coordinates missing (skip virtual/online addresses)
      const skipGeocode = !raw.address || /^online$/i.test(String(raw.address).trim()) || raw.region === 'online'
      if (!skipGeocode && raw.latitude == null) {
        const coords = await geocode(raw.address)
        if (coords) {
          raw.latitude = coords.latitude
          raw.longitude = coords.longitude
          log.ok(`Geocoded: ${raw.address} → ${coords.latitude}, ${coords.longitude}`)
        }
      }

      const record = {
        ...raw,
        source_type: sourceType,
        last_seen_at: new Date().toISOString(),
        status: 'approved', // ingested data is trusted
      }

      // Try upsert by (source_type, external_id) if we have an external_id
      if (record.external_id) {
        const { data: existing } = await supabase
          .from('items')
          .select('id, deleted_at')
          .eq('source_type', sourceType)
          .eq('external_id', record.external_id)
          .single()

        if (existing) {
          if (existing.deleted_at) {
            log.skip(`Skipping soft-deleted: ${record.title}`)
            skipped++
            continue
          }
          // Update existing record
          const { error } = await supabase
            .from('items')
            .update({
              title: record.title,
              description: record.description,
              start_time: record.start_time,
              end_time: record.end_time,
              location_name: record.location_name,
              address: record.address,
              city: record.city,
              region: record.region,
              latitude: record.latitude,
              longitude: record.longitude,
              external_link: record.external_link,
              tags: record.tags,
              last_seen_at: record.last_seen_at,
            })
            .eq('id', existing.id)
          if (error) { log.error(`Update failed "${record.title}": ${error.message}`); failed++; continue }
          log.ok(`Updated: ${record.title}`)
          updated++
          continue
        }
      } else {
        // Fallback dedup: match by title + start_time
        if (record.start_time) {
          const { data: existing } = await supabase
            .from('items')
            .select('id')
            .ilike('title', record.title)
            .eq('start_time', record.start_time)
            .is('deleted_at', null)
            .limit(1)
          if (existing?.length) {
            // Update last_seen_at only
            await supabase.from('items').update({ last_seen_at: record.last_seen_at }).eq('id', existing[0].id)
            log.skip(`Already exists: ${record.title}`)
            skipped++
            continue
          }
        }
      }

      // Insert new
      const { error } = await supabase.from('items').insert(record)
      if (error) {
        if (error.code === '23505') {
          log.skip(`Duplicate: ${record.title}`)
          skipped++
        } else {
          log.error(`Insert failed "${record.title}": ${error.message}`)
          failed++
        }
        continue
      }
      log.ok(`Inserted: ${record.title}`)
      inserted++
    } catch (err) {
      log.error(`Unexpected error for "${raw.title}": ${err.message}`)
      failed++
    }
  }

  return { inserted, updated, skipped, failed }
}
