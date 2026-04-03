import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

/**
 * Daily cleanup cron — removes stale events from the database.
 *
 * Deletion rule: start_time < NOW() - 2 days
 *   • Events clearly in the past are removed.
 *   • Items with no start_time (places, food, etc.) are never touched.
 *   • Future events are never deleted.
 *
 * Secured with the same CRON_SECRET Bearer token as the ingestion route.
 * Scheduled at 03:00 UTC daily — see vercel.json.
 *
 * Returns: { success: true, deleted: number }
 */
export async function GET(request: NextRequest) {
  const secret   = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServerSupabase()

  // Cutoff: 2 days ago (server-side time — never client-side)
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

  const { error, count } = await supabase
    .from('items')
    .delete({ count: 'exact' })
    .not('start_time', 'is', null)   // never touch items without a start_time
    .lt('start_time', cutoff)        // only delete events clearly in the past

  if (error) {
    console.error('[cleanup] delete error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const deleted = count ?? 0
  console.log(`[cleanup] deleted ${deleted} stale events (cutoff: ${cutoff})`)

  return NextResponse.json({ success: true, deleted })
}
