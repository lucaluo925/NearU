import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { haversineDistance, radiusBoundingBox, startOfLADay, endOfLADay } from '@/lib/utils'
import { isTableMissing } from '@/lib/db-errors'

// ── Rating helpers ────────────────────────────────────────────────────────────

type RatingEntry = { avg_rating: number; review_count: number }

async function fetchRatings(
  supabase: ReturnType<typeof getServerSupabase>,
  itemIds: string[],
): Promise<Record<string, RatingEntry>> {
  if (itemIds.length === 0) return {}
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('item_id, rating')
      .in('item_id', itemIds)
    if (error || !data) return {}

    const sums: Record<string, number> = {}
    const counts: Record<string, number> = {}
    for (const r of data) {
      sums[r.item_id]   = (sums[r.item_id]   ?? 0) + (r.rating as number)
      counts[r.item_id] = (counts[r.item_id] ?? 0) + 1
    }
    const out: Record<string, RatingEntry> = {}
    for (const id of Object.keys(counts)) {
      out[id] = {
        avg_rating:   Math.round((sums[id] / counts[id]) * 10) / 10,
        review_count: counts[id],
      }
    }
    return out
  } catch {
    return {}
  }
}

async function fetchPopularity(
  supabase: ReturnType<typeof getServerSupabase>,
  itemIds: string[],
): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {}
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('interaction_logs')
      .select('item_id')
      .in('item_id', itemIds)
      .gte('created_at', since)
    if (error || !data) return {}
    const counts: Record<string, number> = {}
    for (const { item_id } of data) counts[item_id] = (counts[item_id] ?? 0) + 1
    return counts
  } catch {
    return {}
  }
}

function bestNearbyScore(
  distMiles: number | undefined,
  rating: number | null,
  popularity: number,
  maxDist: number,
  maxPop: number,
): number {
  const d = distMiles ?? maxDist
  const distScore   = 1 - Math.min(d / Math.max(maxDist, 0.1), 1)
  const ratingScore = (rating ?? 2.5) / 5
  const popScore    = maxPop > 0 ? popularity / maxPop : 0
  return 0.4 * distScore + 0.4 * ratingScore + 0.2 * popScore
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getServerSupabase()
  const { searchParams } = new URL(request.url)

  const category     = searchParams.get('category')
  const subcategory  = searchParams.get('subcategory')
  const search       = searchParams.get('search')
  const tags         = searchParams.getAll('tag')
  const time         = searchParams.get('time')
  const sort         = searchParams.get('sort') ?? 'upcoming'
  const includePast  = searchParams.get('includePast') === 'true'

  const lat    = searchParams.get('lat')    ? parseFloat(searchParams.get('lat')!)    : null
  const lng    = searchParams.get('lng')    ? parseFloat(searchParams.get('lng')!)    : null
  const radius = searchParams.get('radius') ? parseFloat(searchParams.get('radius')!) : null
  const hasGeo = lat !== null && lng !== null && radius !== null

  let query = supabase
    .from('items')
    .select('*')
    .is('deleted_at', null)
    .eq('status', 'approved')

  if (category)    query = query.eq('category', category)
  if (subcategory) query = query.eq('subcategory', subcategory)
  if (search)      query = query.or(`title.ilike.%${search}%,address.ilike.%${search}%,location_name.ilike.%${search}%`)
  if (tags.length > 0) query = query.overlaps('tags', tags)

  const now = new Date().toISOString()
  // Filter out past events: items with start_time must be within 6-hour buffer of now.
  // Items without start_time (food, places, etc.) are always shown.
  // This replaces the broken end_time filter which let events with no end_time slip through.
  if (!includePast) {
    const cutoff6h = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    query = query.or(`start_time.is.null,start_time.gte.${cutoff6h}`)
  }

  if (time === 'today') {
    // Use LA-timezone midnight so tonight's events (after 5 PM PDT) are included.
    const eod = endOfLADay(new Date(), 0)
    query = query.gte('start_time', now).lte('start_time', eod.toISOString())
  } else if (time === 'tomorrow') {
    // Strictly the next LA calendar day — startOfLADay(+1) to endOfLADay(+1).
    const nt = new Date()
    const sol = startOfLADay(nt, 1)
    const eol = endOfLADay(nt, 1)
    query = query.gte('start_time', sol.toISOString()).lte('start_time', eol.toISOString())
  } else if (time === 'this-week') {
    const eow = endOfLADay(new Date(), 7)
    query = query.gte('start_time', now).lte('start_time', eow.toISOString())
  }

  // Custom date range filter (takes precedence over time preset when both provided)
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')
  if (dateFrom && dateTo && !time) {
    // dateTo is YYYY-MM-DD — extend to end of that day
    const toEnd = new Date(dateTo); toEnd.setHours(23, 59, 59, 999)
    query = query.gte('start_time', new Date(dateFrom).toISOString()).lte('start_time', toEnd.toISOString())
  }

  if (hasGeo) {
    const box = radiusBoundingBox(lat!, lng!, radius!)
    query = query
      .not('latitude', 'is', null).not('longitude', 'is', null)
      .gte('latitude', box.minLat).lte('latitude', box.maxLat)
      .gte('longitude', box.minLng).lte('longitude', box.maxLng)
  }

  // DB-level ordering for base sorts; JS sorts handled below
  const jsSort = ['nearest', 'top-rated', 'popular', 'best-nearby']
  if (sort === 'newest') {
    query = query.order('created_at', { ascending: false })
  } else if (!jsSort.includes(sort)) {
    query = query
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let results = data as Array<Record<string, unknown>>

  // Haversine exact filter + distance
  if (hasGeo) {
    results = results
      .map((item) => {
        const d = haversineDistance(lat!, lng!, item.latitude as number, item.longitude as number)
        return { ...item, distance_miles: Math.round(d * 10) / 10 }
      })
      .filter((item) => (item.distance_miles as number) <= radius!)
  }

  // ── Ratings (always fetched for enriched card display) ─────────────────────
  const ids = results.map((r) => r.id as string)
  const [ratingMap, popularityMap] = await Promise.all([
    fetchRatings(supabase, ids),
    sort === 'popular' || sort === 'best-nearby'
      ? fetchPopularity(supabase, ids)
      : Promise.resolve({} as Record<string, number>),
  ])

  // Augment results with rating data
  results = results.map((item) => {
    const r = ratingMap[item.id as string]
    return {
      ...item,
      avg_rating:   r?.avg_rating   ?? null,
      review_count: r?.review_count ?? 0,
    }
  })

  // ── JS sorts ────────────────────────────────────────────────────────────────
  if (sort === 'nearest') {
    results.sort((a, b) => {
      const da = (a.distance_miles as number | undefined) ?? Infinity
      const db = (b.distance_miles as number | undefined) ?? Infinity
      return da - db
    })
  } else if (sort === 'top-rated') {
    results.sort((a, b) => {
      const ra = (a.avg_rating as number | null) ?? 0
      const rb = (b.avg_rating as number | null) ?? 0
      const ca = (a.review_count as number) ?? 0
      const cb = (b.review_count as number) ?? 0
      if (rb !== ra) return rb - ra
      return cb - ca
    })
  } else if (sort === 'popular') {
    results.sort((a, b) => {
      const pa = popularityMap[a.id as string] ?? 0
      const pb = popularityMap[b.id as string] ?? 0
      return pb - pa
    })
  } else if (sort === 'best-nearby') {
    const maxDist = Math.max(...results.map((i) => (i.distance_miles as number | undefined) ?? 0), 1)
    const maxPop  = Math.max(...Object.values(popularityMap), 1)
    results.sort((a, b) => {
      const sa = bestNearbyScore(
        a.distance_miles as number | undefined,
        a.avg_rating as number | null,
        popularityMap[a.id as string] ?? 0,
        maxDist, maxPop,
      )
      const sb = bestNearbyScore(
        b.distance_miles as number | undefined,
        b.avg_rating as number | null,
        popularityMap[b.id as string] ?? 0,
        maxDist, maxPop,
      )
      return sb - sa
    })
  }

  return NextResponse.json(results.slice(0, 100))
}
