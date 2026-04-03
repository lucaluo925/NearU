import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { isTableMissing } from '@/lib/db-errors'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const TOP_N = 10

function topIds(rows: { item_id: string }[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const { item_id } of rows) counts.set(item_id, (counts.get(item_id) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id)
}

export async function GET(req: NextRequest) {
  const idsOnly = req.nextUrl.searchParams.get('ids_only') === '1'
  const supabase = getServerSupabase()
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

  // Fetch recent interactions
  const { data: rows, error } = await supabase
    .from('interaction_logs')
    .select('item_id, type')
    .gte('created_at', since)

  if (error) {
    if (isTableMissing(error)) return NextResponse.json({ trending: [], popular: [] })
    return NextResponse.json({ trending: [], popular: [] }, { status: 500 })
  }

  const viewRows = (rows ?? []).filter((r) => r.type === 'view')
  const favRows  = (rows ?? []).filter((r) => r.type === 'favorite')

  const trendingIds = topIds(viewRows, TOP_N)
  const popularIds  = topIds(favRows,  TOP_N)

  if (idsOnly) {
    return NextResponse.json({ trending: trendingIds, popular: popularIds })
  }

  // Fetch full item data for both sets
  const allIds = [...new Set([...trendingIds, ...popularIds])]
  if (allIds.length === 0) {
    return NextResponse.json({ trending: [], popular: [] })
  }

  // Only surface upcoming / recently-ended events (6-hour grace window).
  // Items without a start_time (places, food, etc.) are always included.
  const cutoff6h = new Date(Date.now() - 6 * 3600 * 1000).toISOString()

  const { data: items } = await supabase
    .from('items')
    .select('*')
    .in('id', allIds)
    .is('deleted_at', null)
    .eq('status', 'approved')
    .or(`start_time.is.null,start_time.gte.${cutoff6h}`)

  const itemMap = new Map((items ?? []).map((i) => [i.id, i]))

  const trending = trendingIds.map((id) => itemMap.get(id)).filter(Boolean)
  const popular  = popularIds.map((id)  => itemMap.get(id)).filter(Boolean)

  return NextResponse.json({ trending, popular })
}
