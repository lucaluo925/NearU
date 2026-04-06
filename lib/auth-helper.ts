import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'

/**
 * Extracts the authenticated user from a Next.js API route request.
 * Supports two auth mechanisms:
 *   1. Cookie-based session (web client via @supabase/ssr)
 *   2. Bearer token in Authorization header (mobile client)
 * Returns null if the request is unauthenticated.
 */
export async function getSessionUser(req: NextRequest): Promise<User | null> {
  try {
    // ── Bearer token (mobile clients) ────────────────────────────────────────
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await supabase.auth.getUser(token)
      return user ?? null
    }

    // ── Cookie-based session (web clients) ───────────────────────────────────
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll() },
          setAll() {},
        },
      },
    )
    const { data: { user } } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
}
