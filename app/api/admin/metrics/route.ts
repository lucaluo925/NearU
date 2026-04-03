import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

export interface AdminMetrics {
  users: {
    total: number
    new_this_week: number
  }
  submissions: {
    total: number
    pending: number
    approved: number
    rejected: number
    flagged: number
  }
  listings: {
    total: number
  }
}

export async function GET(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = getServerSupabase()
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Run all queries in parallel
  const [
    totalUsers,
    newUsers,
    totalSubmissions,
    pendingCount,
    approvedCount,
    rejectedCount,
    flaggedCount,
    totalListings,
  ] = await Promise.all([
    // Total users (profiles table)
    supabase.from('profiles').select('*', { count: 'exact', head: true }),

    // New users this week
    supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', oneWeekAgo),

    // Total user submissions (source = 'user')
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('source', 'user').is('deleted_at', null),

    // Pending
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'pending').is('deleted_at', null),

    // Approved
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'approved').is('deleted_at', null),

    // Rejected
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'rejected').is('deleted_at', null),

    // Flagged
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'flagged').is('deleted_at', null),

    // Total live listings
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'approved').is('deleted_at', null),
  ])

  const metrics: AdminMetrics = {
    users: {
      total: totalUsers.count ?? 0,
      new_this_week: newUsers.count ?? 0,
    },
    submissions: {
      total: totalSubmissions.count ?? 0,
      pending: pendingCount.count ?? 0,
      approved: approvedCount.count ?? 0,
      rejected: rejectedCount.count ?? 0,
      flagged: flaggedCount.count ?? 0,
    },
    listings: {
      total: totalListings.count ?? 0,
    },
  }

  return NextResponse.json(metrics)
}
