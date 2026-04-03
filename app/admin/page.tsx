import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import AdminClient from './AdminClient'
import { ADMIN_EMAIL } from '@/lib/admin-auth'

export const metadata: Metadata = {
  title: 'Admin — NearU',
}

export default async function AdminPage() {
  // ── Server-side auth double-check ─────────────────────────────────────────
  // proxy.ts is the primary guard; this is a hard fallback in case it's bypassed.
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only in Server Component */ },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const userEmail = (user?.email ?? '').toLowerCase().trim()

  if (!user) {
    redirect('/login?from=/admin')
  }

  if (userEmail !== ADMIN_EMAIL) {
    console.warn(
      `[admin] server component blocked — email="${user?.email}" expected="${ADMIN_EMAIL}" at ${new Date().toISOString()}`
    )
    redirect('/?notice=unauthorized')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header showBack backHref="/" backLabel="Home" title="Admin" />

      <main className="flex-1 max-w-[900px] mx-auto w-full px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-[28px] font-bold tracking-tight text-[#111111] mb-1">
            Admin Dashboard
          </h1>
          <p className="text-[14px] text-[#6B7280]">
            Signed in as{' '}
            <span className="font-medium text-[#374151]">{user.email}</span>
          </p>
        </div>

        <div className="animate-fade-up animate-fade-up-delay-1">
          <AdminClient authorizedEmail={ADMIN_EMAIL} />
        </div>
      </main>

      <Footer />
    </div>
  )
}
