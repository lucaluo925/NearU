import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getServerSupabase } from '@/lib/supabase-server'
import { isTableMissing } from '@/lib/db-errors'
import { POINT_RULES } from '@/lib/points'

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getSessionUser(req: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll() },
          setAll() {},
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
}

// ── Mask email: "alice***@example.com" ───────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const visible = local.slice(0, 3)
  return `${visible}***@${domain}`
}

// ── GET /api/reviews?item_id=xxx ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const item_id = req.nextUrl.searchParams.get('item_id')
  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

  const supabase = getServerSupabase()

  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at, user_id')
    .eq('item_id', item_id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (isTableMissing(error)) return NextResponse.json({ reviews: [], avg_rating: null, review_count: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []

  // Compute aggregate in JS
  const review_count = rows.length
  const avg_rating = review_count > 0
    ? Math.round((rows.reduce((sum, r) => sum + r.rating, 0) / review_count) * 10) / 10
    : null

  // Mask emails — user_id is the Supabase auth uuid, not email.
  // We return the uuid truncated for identification purposes.
  const reviews = rows.slice(0, 5).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment ?? null,
    created_at: r.created_at,
    author: `User ${r.user_id.slice(0, 6)}`,
  }))

  return NextResponse.json({ reviews, avg_rating, review_count })
}

// ── POST /api/reviews — create or update ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to leave a review' }, { status: 401 })

  let body: { item_id?: string; rating?: number; comment?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const { item_id, rating, comment } = body
  if (!item_id || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'item_id and rating (1–5) required' }, { status: 400 })
  }

  const supabase = getServerSupabase()

  // Upsert — one review per (item_id, user_id); update if exists
  const { error } = await supabase
    .from('reviews')
    .upsert(
      { item_id, user_id: user.id, rating, comment: comment?.trim() || null },
      { onConflict: 'item_id,user_id' }
    )

  if (error) {
    if (isTableMissing(error)) return NextResponse.json({ error: 'Reviews not available yet' }, { status: 503 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Award post_review points (fire-and-forget, deduplicated per item per user)
  void (async () => {
    const rule = POINT_RULES.post_review
    try {
      const supa = getServerSupabase()
      // Check dedup: one award per user per item
      const { data: existing } = await supa
        .from('point_events')
        .select('id')
        .eq('user_id', user.id)
        .eq('type', 'post_review')
        .eq('metadata->>item_id', item_id)
        .limit(1)
      if ((existing?.length ?? 0) > 0) return

      await supa.from('point_events').insert({
        user_id: user.id, type: 'post_review', points: rule.points,
        metadata: { item_id },
      })
      await supa.rpc('increment_user_points', { p_user_id: user.id, p_delta: rule.points })
    } catch {}
  })()

  return NextResponse.json({ ok: true })
}
