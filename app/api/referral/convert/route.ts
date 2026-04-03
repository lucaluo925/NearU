import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { POINT_RULES } from '@/lib/points'

// ── POST /api/referral/convert ────────────────────────────────────────────────
//
// Called by ReferralTracker when a new user signs up and has a stored ref code.
//
// Body: { ref_code: string }  — ref_code is the referrer's user UUID
//
// Awards referral_signup points to the REFERRER only if:
//   1. The calling user (referred) is new (has no point_events yet)
//   2. The referrer exists in auth.users (validated via user_points upsert)
//   3. The referral hasn't been attributed already for this referred_user_id

const REFERRAL_POINTS = POINT_RULES.referral_signup.points  // 30

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ref_code?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { ref_code } = body
  if (!ref_code || typeof ref_code !== 'string') {
    return NextResponse.json({ error: 'ref_code required' }, { status: 400 })
  }

  // Don't allow self-referral
  if (ref_code === user.id) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'self_referral' })
  }

  // Validate UUID format (basic check)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(ref_code)) {
    return NextResponse.json({ error: 'invalid ref_code' }, { status: 400 })
  }

  const supabase = getServerSupabase()

  try {
    // 1. Check referred user is new: no point_events exist for them
    const { count: existingEvents } = await supabase
      .from('point_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if ((existingEvents ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'not_new_user' })
    }

    // 2. Check this referral hasn't been attributed already
    const { count: existingReferral } = await supabase
      .from('point_events')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'referral_signup')
      .eq('metadata->>referred_user_id', user.id)

    if ((existingReferral ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_attributed' })
    }

    // 3. Award points to referrer
    const { error: insErr } = await supabase
      .from('point_events')
      .insert({
        user_id:  ref_code,                    // referrer earns
        type:     'referral_signup',
        points:   REFERRAL_POINTS,
        metadata: { referred_user_id: user.id },
      })

    if (insErr) throw insErr

    await supabase.rpc('increment_user_points', {
      p_user_id: ref_code,
      p_delta:   REFERRAL_POINTS,
    })

    return NextResponse.json({ ok: true, skipped: false })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err?.code === '42P01') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'system_not_ready' })
    }
    console.error('[referral/convert]', err?.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
