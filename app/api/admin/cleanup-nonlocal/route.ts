import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

/**
 * Comprehensive cleanup: soft-delete ALL non-local events from the database.
 *
 * "Local" is defined as:
 *   • Within 50 miles of Davis, CA (38.5449, -121.7405) — if coordinates exist
 *   • City/address matches a known local area — if no coordinates
 *
 * Idempotent: only touches rows where deleted_at IS NULL.
 * Safe to call repeatedly.
 *
 * POST /api/admin/cleanup-nonlocal
 */

// ── Davis geographic center ───────────────────────────────────────────────────
const DAVIS_LAT = 38.5449
const DAVIS_LNG = -121.7405
const MAX_RADIUS_MILES = 50

function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Locality patterns ─────────────────────────────────────────────────────────

/** Cities within ~50 miles of Davis that are acceptable. */
const LOCAL_CITY_RE = /\b(davis|sacramento|west\s*sacramento|woodland|dixon|winters|vacaville|fairfield|elk\s*grove|rancho\s*cordova|folsom|roseville|citrus\s*heights|natomas|yolo)\b/i

/** Non-California US state abbreviations (word-bounded). */
const BAD_STATE_RE = /\b(VA|TX|FL|MD|NY|IL|WA|OR|NV|AZ|CO|GA|NC|OH|PA|MA|MI|MN|HI|AK|ID|MT|WY|ND|SD|NE|KS|OK|LA|MS|AL|TN|KY|WV|IN|MO|IA|WI|MN|AR)\b/

/** Southern California and other clearly non-local California cities. */
const NONLOCAL_CA_RE = /\b(irvine|los\s*angeles|l\.?a\.?\b|san\s*diego|anaheim|santa\s*ana|orange\s*county|riverside|long\s*beach|san\s*jose|san\s*francisco|s\.?f\.?\b|berkeley|oakland|fresno|bakersfield|stockton|modesto|santa\s*barbara|santa\s*cruz|san\s*luis\s*obispo|pasadena|glendale|burbank|torrance)\b/i

interface CleanupItem {
  id: string
  title: string | null
  latitude: number | null
  longitude: number | null
  city: string | null
  address: string | null
  source_type: string | null
}

interface RejectedItem {
  id: string
  title: string
  source: string
  reason: string
}

function classifyItem(item: CleanupItem): { keep: boolean; reason?: string } {
  const addr   = item.address  ?? ''
  const city   = item.city     ?? ''
  const combined = `${city} ${addr}`

  // 1. Coordinate check — most authoritative
  if (item.latitude != null && item.longitude != null) {
    const dist = haversineDistanceMiles(DAVIS_LAT, DAVIS_LNG, item.latitude, item.longitude)
    if (dist > MAX_RADIUS_MILES) {
      return { keep: false, reason: `out_of_radius: ${dist.toFixed(1)}mi from Davis` }
    }
    return { keep: true }
  }

  // 2. Non-CA US state in address → definitely remote
  if (BAD_STATE_RE.test(addr)) {
    return { keep: false, reason: `non_ca_state: ${addr.match(BAD_STATE_RE)?.[0]}` }
  }

  // 3. Clearly non-local California city
  if (NONLOCAL_CA_RE.test(combined)) {
    return { keep: false, reason: `nonlocal_ca_city: ${NONLOCAL_CA_RE.exec(combined)?.[0]}` }
  }

  // 4. City explicitly set but NOT matching local area
  if (city && !LOCAL_CITY_RE.test(city) && !LOCAL_CITY_RE.test(addr)) {
    return { keep: false, reason: `unknown_city: ${city}` }
  }

  return { keep: true }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!await getAdminUser(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServerSupabase()
  const now      = new Date().toISOString()
  const rejected: RejectedItem[] = []

  // ── Paginate through ALL non-deleted items ────────────────────────────────
  // Fetch in batches of 1000 to handle large tables without OOM
  const PAGE_SIZE = 1000
  let page = 0
  let totalFetched = 0

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('id, title, latitude, longitude, city, address, source_type')
      .is('deleted_at', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .order('id')

    if (error) {
      console.error('[cleanup-nonlocal] fetch error:', error.message)
      break
    }
    if (!data || data.length === 0) break

    totalFetched += data.length

    for (const item of data as CleanupItem[]) {
      const result = classifyItem(item)
      if (!result.keep) {
        rejected.push({
          id:     item.id,
          title:  item.title ?? '(no title)',
          source: item.source_type ?? 'unknown',
          reason: result.reason ?? 'unknown',
        })
      }
    }

    if (data.length < PAGE_SIZE) break
    page++
  }

  // ── Soft-delete all rejected items ────────────────────────────────────────
  let deleted = 0
  if (rejected.length > 0) {
    const ids = rejected.map((r) => r.id)

    // Delete in batches of 500 to avoid URL length limits
    const BATCH = 500
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const { error } = await supabase
        .from('items')
        .update({ deleted_at: now })
        .in('id', batch)
        .is('deleted_at', null)  // extra safety: don't double-touch
      if (!error) deleted += batch.length
      else console.error('[cleanup-nonlocal] delete batch error:', error.message)
    }
  }

  // ── Group rejected by reason for summary ─────────────────────────────────
  const byReason: Record<string, number> = {}
  for (const r of rejected) {
    const key = r.reason.split(':')[0]
    byReason[key] = (byReason[key] ?? 0) + 1
  }

  const bySource: Record<string, number> = {}
  for (const r of rejected) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
  }

  const result = {
    ok: true,
    scanned: totalFetched,
    deleted,
    by_reason: byReason,
    by_source: bySource,
    samples: rejected.slice(0, 30).map((r) => ({
      title:  r.title.slice(0, 80),
      source: r.source,
      reason: r.reason,
    })),
  }

  console.log('[cleanup-nonlocal]', JSON.stringify(result))
  return NextResponse.json(result)
}
