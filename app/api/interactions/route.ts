import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { isTableMissing } from '@/lib/db-errors'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { item_id, type } = body
    if (!item_id || !['view', 'favorite'].includes(type)) {
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
