import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'

/**
 * Extracts the authenticated user from a Next.js API route request.
 * Returns null if the request is unauthenticated.
 */
export async function getSessionUser(req: NextRequest): Promise<User | null> {
  try {
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
