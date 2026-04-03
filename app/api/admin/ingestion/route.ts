import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

export interface IngestionLog {
  id: string
  run_at: string
  source: string
  inserted_count: number
  updated_count: number
  skipped_count: number
  failed_count: number
  total_parsed: number
  status: 'success' | 'partial' | 'failed'
  error_message: string | null
}

export async function GET(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = getServerSupabase()

  const { data, error } = await supabase
    .from('ingestion_logs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(20)

  if (error) {
    // Table may not exist yet — return empty rather than 500
    if (error.code === '42P01') {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
