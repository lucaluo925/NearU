import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Single source of truth — must match lib/admin-auth.ts */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'zix7622@163.com').toLowerCase().trim()

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only guard /admin routes
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ── Not logged in ────────────────────────────────────────────────────────────
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Logged in but wrong email (strict check) ─────────────────────────────────
  const userEmail = (user.email ?? '').toLowerCase().trim()
  if (userEmail !== ADMIN_EMAIL) {
    console.warn(
      `[admin] blocked page access — email="${user.email}" expected="${ADMIN_EMAIL}" path="${pathname}" at ${new Date().toISOString()}`
    )
    // Redirect home with a flag so the UI can show a notice
    return NextResponse.redirect(new URL('/?notice=unauthorized', request.url))
  }

  return response
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
