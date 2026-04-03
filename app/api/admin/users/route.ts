import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

export interface AdminUser {
  id: string
  email: string | null
  display_name: string | null
  role: string
  created_at: string
  last_seen_at: string | null
  submission_count: number
}

export async function GET(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const supabase = getServerSupabase()

    // ── 1. Auth users — the only complete source of truth ────────────────────
    // auth.admin.listUsers() requires service role key and returns every signup.
    // If SUPABASE_SERVICE_ROLE_KEY is not configured it returns an empty list
    // (the error is caught below and we fall back to profiles-only).
    let authUsers: Array<{
      id: string
      email?: string
      created_at: string
      last_sign_in_at?: string
    }> = []

    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    })

    if (!authError && authData?.users?.length) {
      authUsers = authData.users
    } else if (authError) {
      console.warn('[admin/users] auth.admin.listUsers failed:', authError.message)
    }

    // ── 2. Profiles table — supplementary data (display_name, role, last_seen) ─
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, display_name, role, last_seen_at, created_at')

    if (profileError && profileError.code !== '42P01') {
      // Real error (not just "table doesn't exist") — log but continue
      console.warn('[admin/users] profiles query failed:', profileError.message)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profileMap = new Map<string, any>(
      (profileRows ?? []).map((p) => [p.id as string, p])
    )

    // ── 3. Submission counts per user id ──────────────────────────────────────
    const { data: submissionRows } = await supabase
      .from('items')
      .select('created_by')
      .is('deleted_at', null)

    const countByUser: Record<string, number> = {}
    for (const row of submissionRows ?? []) {
      if (row.created_by) {
        countByUser[row.created_by] = (countByUser[row.created_by] ?? 0) + 1
      }
    }

    // ── 4. Merge ──────────────────────────────────────────────────────────────
    // Primary path: auth user list (complete — catches users with no profile row)
    // Fallback path: profiles-only (when service role key not available)

    let users: AdminUser[]

    if (authUsers.length > 0) {
      users = authUsers.map((u) => {
        const p = profileMap.get(u.id)
        return {
          id:               u.id,
          email:            u.email ?? p?.email ?? null,
          display_name:     p?.display_name ?? null,
          role:             p?.role ?? 'user',
          created_at:       u.created_at,
          last_seen_at:     p?.last_seen_at ?? u.last_sign_in_at ?? null,
          submission_count: countByUser[u.id] ?? 0,
        }
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else {
      // Fallback: profiles table only
      users = (profileRows ?? []).map((p) => ({
        id:               p.id as string,
        email:            (p.email as string | null) ?? null,
        display_name:     (p.display_name as string | null) ?? null,
        role:             (p.role as string) ?? 'user',
        created_at:       p.created_at as string,
        last_seen_at:     (p.last_seen_at as string | null) ?? null,
        submission_count: countByUser[p.id as string] ?? 0,
      }))
    }

    return NextResponse.json(users)
  } catch (err) {
    console.error('[admin/users] unexpected error:', (err as Error).message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
