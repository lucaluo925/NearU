import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { limiters, getRequestKey, rateLimitResponse } from '@/lib/rate-limit'
import { POINT_RULES } from '@/lib/points'

// ── POST /api/points/award ────────────────────────────────────────────────────
//
// Body: { type: string, metadata?: Record<string, string> }
// Returns: { ok, points, current_points, total_points_earned, skipped }
//
// Anti-abuse:
//   • oneTime rules are only awarded once per user lifetime
//   • dedupeByItem rules are deduped by metadata.item_id per user
//   • dailyCap rules count awards in the current UTC calendar day
// ─────────────────────────────────────────────────────────────────────────────

function utcDayStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 60 per user per minute (prevents wasted DB round-trips)
  const rl = limiters.pointsAward.check(getRequestKey(req, user.id))
  if (rl.limited) return rateLimitResponse(rl.resetIn)

  let body: { type?: string; metadata?: Record<string, string> }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { type, metadata = {} } = body
  if (!type) return NextResponse.json({ error: 'type required' }, { status: 400 })

  const rule = POINT_RULES[type]
  if (!rule) return NextResponse.json({ error: `unknown type: ${type}` }, { status: 400 })

  const supabase = getServerSupabase()

  // ── Anti-abuse checks ─────────────────────────────────────────────────────

  try {
    // 1. One-time: check if any event of this type already exists for user
    if (rule.oneTime) {
      const { data } = await supabase
        .from('point_events')
        .select('id')
        .eq('user_id', user.id)
        .eq('type', type)
        .limit(1)
      if ((data?.length ?? 0) > 0) {
        return NextResponse.json({ ok: true, skipped: true, points: 0 })
      }
    }

    // 2. Dedupe by item_id: one award per user per item for this type
    if (rule.dedupeByItem && metadata.item_id) {
      const { data } = await supabase
        .from('point_events')
        .select('id')
        .eq('user_id', user.id)
        .eq('type', type)
        .eq('metadata->>item_id', metadata.item_id)
        .limit(1)
      if ((data?.length ?? 0) > 0) {
        return NextResponse.json({ ok: true, skipped: true, points: 0 })
      }
    }

    // 3. Daily cap: count awards today
    if (rule.dailyCap) {
      const dayStart = utcDayStart()
      const { count } = await supabase
        .from('point_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', type)
        .gte('created_at', dayStart)
      if ((count ?? 0) >= rule.dailyCap) {
        return NextResponse.json({ ok: true, skipped: true, points: 0 })
      }
    }

    // ── Insert point event ───────────────────────────────────────────────────
    const { error: insErr } = await supabase
      .from('point_events')
      .insert({ user_id: user.id, type, points: rule.points, metadata })

    if (insErr) throw insErr

    // ── Update balance atomically via RPC ────────────────────────────────────
    const { data: bal, error: rpcErr } = await supabase
      .rpc('increment_user_points', { p_user_id: user.id, p_delta: rule.points })

    if (rpcErr) throw rpcErr

    const row = Array.isArray(bal) ? bal[0] : bal
    return NextResponse.json({
      ok: true,
      skipped: false,
      points: rule.points,
      current_points:      row?.current_points      ?? rule.points,
      total_points_earned: row?.total_points_earned ?? rule.points,
    })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err?.code === '42P01') {
      // Tables not created yet — silently skip
      return NextResponse.json({ ok: true, skipped: true, points: 0 })
    }
    console.error('[points/award]', err?.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
