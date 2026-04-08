import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { isTableMissing } from '@/lib/db-errors'

// ── Simple in-process rate limiter (max 120 interactions per IP per minute) ───
// This is a lightweight guard against interaction-log spam. It is intentionally
// loose (interactions are anonymous public events) but prevents trivial flooding.
const interactionHits = new Map<string, number[]>()
const INTERACTION_WINDOW_MS  = 60_000 // 1 minute
const INTERACTION_MAX_PER_IP = 120    // generous limit for normal browsing

function isInteractionRateLimited(ip: string): boolean {
  const now  = Date.now()
  const hits = (interactionHits.get(ip) ?? []).filter(t => now - t < INTERACTION_WINDOW_MS)
  if (hits.length >= INTERACTION_MAX_PER_IP) return true
  hits.push(now)
  interactionHits.set(ip, hits)
  // Prune map to avoid unbounded growth
  if (interactionHits.size > 5_000) {
    for (const [k, v] of interactionHits) {
      if (v.every(t => now - t >= INTERACTION_WINDOW_MS)) interactionHits.delete(k)
    }
  }
  return false
}

// UUID v4 format check — item_id must be a valid UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  if (isInteractionRateLimited(ip)) {
    return NextResponse.json({ ok: true }) // silent accept to avoid leaking rate-limit info
  }

  try {
    const body = await req.json()
    const { item_id, type } = body

    // Validate type enum
    if (!['view', 'favorite'].includes(type)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    // Validate item_id is a UUID — prevents injecting arbitrary IDs
    if (!item_id || typeof item_id !== 'string' || !UUID_RE.test(item_id)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    const supabase = getServerSupabase()
    const { error } = await supabase
      .from('interaction_logs')
      .insert({ item_id, type })

    if (error) {
      // Table not yet created — silently ignore
      if (isTableMissing(error)) return NextResponse.json({ ok: true })
      console.error('interaction insert error', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'unexpected' }, { status: 500 })
  }
}
