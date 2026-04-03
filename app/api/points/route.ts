import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { labelForType } from '@/lib/points'

// ── GET /api/points — current balance + recent history ───────────────────────

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServerSupabase()

  // Fetch balance
  const { data: balance, error: balErr } = await supabase
    .from('user_points')
    .select('current_points, total_points_earned')
    .eq('user_id', user.id)
    .maybeSingle()

  if (balErr && balErr.code !== 'PGRST116') {
    if (balErr.code === '42P01') {
      // Table not created yet — return zeros
      return NextResponse.json({ current_points: 0, total_points_earned: 0, history: [] })
    }
    return NextResponse.json({ error: balErr.message }, { status: 500 })
  }

  // Fetch last 30 events — earning and spending (eggs, unlocks, etc.)
  const { data: events, error: evtErr } = await supabase
    .from('point_events')
    .select('id, type, points, metadata, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (evtErr && evtErr.code === '42P01') {
    return NextResponse.json({ current_points: 0, total_points_earned: 0, history: [] })
  }

  const history = (events ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    points: e.points,
    label: labelForType(e.type),
    metadata: e.metadata,
    created_at: e.created_at,
  }))

  return NextResponse.json({
    current_points:      balance?.current_points      ?? 0,
    total_points_earned: balance?.total_points_earned ?? 0,
    history,
  })
}
