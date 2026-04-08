import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { isTableMissing } from '@/lib/db-errors'
import { limiters, getRequestKey, rateLimitResponse } from '@/lib/rate-limit'

// UUID v4 format check — item_id must be a valid UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  // Rate limit by IP (public endpoint — no auth, silent 200 on exceed)
  const rl = limiters.interactions.check(getRequestKey(req))
  if (rl.limited) return rateLimitResponse(rl.resetIn, /* silent */ true)

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
