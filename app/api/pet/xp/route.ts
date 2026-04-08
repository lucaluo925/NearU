import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { limiters, getRequestKey, rateLimitResponse, guardBodySize } from '@/lib/rate-limit'
import { PET_XP_REWARDS, computeLevel, computeMood } from '@/lib/pet'

// ── POST /api/pet/xp — award XP for an action ────────────────────────────────
//
// Body: { action: 'save_item' | 'share' | 'add_to_calendar' }
// Returns: { xp, level, mood, level_up }

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Body size guard: payload is just { action: string } — 1 KB is generous
  const sizeErr = guardBodySize(req, 1024)
  if (sizeErr) return sizeErr

  // Rate limit: 60 per user per minute (one XP call per user action)
  const rl = limiters.petXp.check(getRequestKey(req, user.id))
  if (rl.limited) return rateLimitResponse(rl.resetIn)

  let body: { action?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { action } = body
  const gain = action ? (PET_XP_REWARDS[action] ?? 0) : 0
  if (gain <= 0) return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const supabase = getServerSupabase()

  try {
    // Fetch current XP before update so we can detect level-up
    const { data: before } = await supabase
      .from('user_pets')
      .select('xp')
      .eq('user_id', user.id)
      .maybeSingle()

    const prevXp    = before?.xp ?? 0
    const prevLevel = computeLevel(prevXp)

    // Atomically add XP via RPC (creates pet row if absent)
    const { data: rpcResult, error: rpcErr } = await supabase
      .rpc('add_pet_xp', { p_user_id: user.id, p_xp: gain })

    if (rpcErr) {
      if (rpcErr.code === '42P01') {
        // Table not ready — silently succeed
        return NextResponse.json({ xp: prevXp + gain, level: prevLevel, mood: 'happy', level_up: false })
      }
      throw rpcErr
    }

    const row      = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
    const newXp    = row?.xp             ?? prevXp + gain
    const newTs    = row?.last_action_at ?? new Date().toISOString()
    const newLevel = computeLevel(newXp)
    const mood     = computeMood(newTs)
    const levelUp  = newLevel > prevLevel

    return NextResponse.json({ xp: newXp, level: newLevel, mood, level_up: levelUp, xp_gained: gain })
  } catch (e: unknown) {
    console.error('[pet/xp]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
