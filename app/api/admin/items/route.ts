import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

/**
 * Admin endpoint — returns items of any status for the admin dashboard.
 * Supports ?status=pending|approved|rejected|flagged|all (default: all)
 */
export async function GET(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = getServerSupabase()
  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status') ?? 'all'

  let query = supabase
    .from('items')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
