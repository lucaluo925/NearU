import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { THEMES, THEME_MAP } from '@/lib/points'

const DEFAULT_STATE = { unlocked: ['default'], active: 'default', current_points: 0 }

// ── GET /api/themes — return unlock state + balance ───────────────────────────

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json(DEFAULT_STATE)

  const supabase = getServerSupabase()

  try {
    const [{ data: themeRow }, { data: pointsRow }] = await Promise.all([
      supabase.from('user_themes').select('unlocked_themes, active_theme').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_points').select('current_points').eq('user_id', user.id).maybeSingle(),
    ])

    return NextResponse.json({
      unlocked:       themeRow?.unlocked_themes ?? ['default'],
      active:         themeRow?.active_theme    ?? 'default',
      current_points: pointsRow?.current_points ?? 0,
    })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code === '42P01') return NextResponse.json(DEFAULT_STATE)
    return NextResponse.json(DEFAULT_STATE)
  }
}

// ── POST /api/themes — unlock or select a theme ───────────────────────────────
//
// Body: { action: 'unlock' | 'select', theme_id: string }

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action?: string; theme_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { action, theme_id } = body
  if (!action || !theme_id) return NextResponse.json({ error: 'action and theme_id required' }, { status: 400 })

  const theme = THEME_MAP[theme_id]
  if (!theme) return NextResponse.json({ error: 'unknown theme' }, { status: 400 })

  const supabase = getServerSupabase()

  try {
    // Fetch current state
    const [{ data: themeRow }, { data: pointsRow }] = await Promise.all([
      supabase.from('user_themes').select('unlocked_themes, active_theme').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_points').select('current_points').eq('user_id', user.id).maybeSingle(),
    ])

    const unlocked: string[]  = themeRow?.unlocked_themes ?? ['default']
    const active: string      = themeRow?.active_theme    ?? 'default'
    const currentPoints: number = pointsRow?.current_points ?? 0

    // ── Unlock ────────────────────────────────────────────────────────────────
    if (action === 'unlock') {
      if (theme.cost === 0 || unlocked.includes(theme_id)) {
        // Already unlocked or free — just return current state
        return NextResponse.json({ unlocked, active, current_points: currentPoints })
      }
      if (currentPoints < theme.cost) {
        return NextResponse.json({ error: `Not enough points (need ${theme.cost}, have ${currentPoints})` }, { status: 402 })
      }

      const newUnlocked = [...unlocked, theme_id]

      // Deduct points atomically + upsert theme row
      const [rpcResult] = await Promise.all([
        supabase.rpc('increment_user_points', { p_user_id: user.id, p_delta: -theme.cost }),
        supabase.from('user_themes').upsert({
          user_id: user.id,
          unlocked_themes: newUnlocked,
          active_theme: active,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        supabase.from('point_events').insert({
          user_id: user.id,
          type: 'unlock_theme',
          points: -theme.cost,
          metadata: { theme_id, theme_name: theme.name },
        }),
      ])

      const balRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
      return NextResponse.json({
        unlocked:       newUnlocked,
        active,
        current_points: balRow?.current_points ?? Math.max(0, currentPoints - theme.cost),
      })
    }

    // ── Select ────────────────────────────────────────────────────────────────
    if (action === 'select') {
      if (theme.cost > 0 && !unlocked.includes(theme_id)) {
        return NextResponse.json({ error: 'Theme not unlocked' }, { status: 403 })
      }

      await supabase.from('user_themes').upsert({
        user_id: user.id,
        unlocked_themes: unlocked,
        active_theme: theme_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

      return NextResponse.json({ unlocked, active: theme_id, current_points: currentPoints })
    }

    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err?.code === '42P01') return NextResponse.json({ error: 'Points system not set up yet' }, { status: 503 })
    console.error('[themes]', err?.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
