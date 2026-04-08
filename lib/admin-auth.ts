/**
 * Shared admin-access helpers.
 *
 * Single source of truth for the admin email.
 * Used by proxy.ts (edge), server components, and API routes.
 */

import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'

/**
 * The one email that may access /admin.
 * Must be configured via the ADMIN_EMAIL environment variable in production.
 * Falls back to empty string so admin access is disabled rather than
 * exposing a hardcoded email address.
 */
export const ADMIN_EMAIL =
  (process.env.ADMIN_EMAIL ?? '').toLowerCase().trim()

// Warn loudly in server logs if the env var is missing, so it is never
// silently misconfigured in production.
if (!process.env.ADMIN_EMAIL) {
  console.warn('[admin-auth] ADMIN_EMAIL env var is not set — admin access is disabled')
}

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
