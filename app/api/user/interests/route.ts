import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InterestsPayload {
  cuisines?:   string[]
  vibes?:      string[]
  prices?:     string[]
  categories?: string[]
  shown?:      boolean
}

// ── GET /api/user/interests ───────────────────────────────────────────────────
// Returns the authenticated user's stored interests, or 404 if none saved yet.

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServerSupabase()

  try {
    const { data, error } = await supabase
      .from('user_interests')
      .select('cuisines, vibes, prices, categories, shown')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') {
      // Table missing — not yet migrated; return 404 so hook falls back to localStorage
      if (error.code === '42P01') return NextResponse.json(null, { status: 404 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) return NextResponse.json(null, { status: 404 })

    return NextResponse.json({
      cuisines:   data.cuisines   ?? [],
      vibes:      data.vibes      ?? [],
      prices:     data.prices     ?? [],
      categories: data.categories ?? [],
      shown:      data.shown      ?? false,
    })
  } catch (e: unknown) {
    console.error('[user/interests GET]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

// ── POST /api/user/interests ──────────────────────────────────────────────────
// Upserts the authenticated user's interests.

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: InterestsPayload
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const supabase = getServerSupabase()

  try {
    const { error } = await supabase
      .from('user_interests')
      .upsert(
        {
          user_id:    user.id,
          cuisines:   body.cuisines   ?? [],
          vibes:      body.vibes      ?? [],
          prices:     body.prices     ?? [],
          categories: body.categories ?? [],
          shown:      body.shown      ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ ok: true, skipped: true })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('[user/interests POST]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
