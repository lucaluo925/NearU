/**
 * Shared admin-access helpers.
 *
 * Single source of truth for the admin email.
 * Used by proxy.ts (edge), server components, and API routes.
 */

import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'

/** The one email that may access /admin. Falls back to the hardcoded owner. */
export const ADMIN_EMAIL =
  (process.env.ADMIN_EMAIL ?? 'zix7622@163.com').toLowerCase().trim()

/**
 * Check whether the authenticated user in a NextRequest is the admin.
 * Used in API route handlers.
 * Returns the user's email on success, null on failure.
 */
export async function getAdminUser(
  request: NextRequest
): Promise<{ email: string } | null> {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll() { /* read-only */ },
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return null
    if (user.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      // Log unauthorised access attempt
      console.warn(
        `[admin] blocked API access — email="${user.email}" expected="${ADMIN_EMAIL}" at ${new Date().toISOString()}`
      )
      return null
    }
    return { email: user.email }
  } catch (err) {
    console.error('[admin] auth check error:', (err as Error).message)
    return null
  }
}
