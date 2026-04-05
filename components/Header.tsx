'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, Heart, LogOut } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { useFavorites } from '@/hooks/useFavorites'
import { cn } from '@/lib/utils'
import PointsBadge from '@/components/PointsBadge'

interface HeaderProps {
  showBack?: boolean
  backHref?: string
  backLabel?: string
  title?: string
  children?: React.ReactNode
}

function FavCount() {
  const { favorites, hydrated } = useFavorites()
  if (!hydrated || favorites.length === 0) return null
  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {favorites.length > 9 ? '9+' : favorites.length}
    </span>
  )
}

// ── Auth buttons ─────────────────────────────────────────────────────────────

function AuthButtons() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createBrowserSupabase()

    // Resolve initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setReady(true)
    })

    // Stay in sync as auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.refresh()
  }

  // Don't render anything until we know the auth state (avoids flash)
  if (!ready) return null

  if (user) {
    return (
      <div className="flex items-center gap-1.5">
        {/* Email — hidden on very small screens */}
        <span
          className="hidden sm:block text-[12px] text-[#9CA3AF] max-w-[130px] truncate"
          title={user.email}
        >
          {user.email}
        </span>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="flex items-center gap-1 text-[12px] font-medium text-[#9CA3AF] hover:text-red-500 border border-[#E5E7EB] hover:border-red-200 px-2.5 py-1.5 rounded-full hover:bg-red-50 transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/login"
        className="text-[13px] font-medium text-[#6B7280] hover:text-[#111111] px-3 py-1.5 rounded-full hover:bg-[#F3F4F6] transition-all"
      >
        Log in
      </Link>
      <Link
        href="/login?mode=signup"
        className={cn(
          'text-[13px] font-semibold border border-[#E5E7EB] text-[#374151]',
          'px-3 py-1.5 rounded-full hover:bg-[#F9FAFB] transition-colors',
          'hidden sm:inline-flex items-center'
        )}
      >
        Sign up
      </Link>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

export default function Header({ showBack, backHref, backLabel, title, children }: HeaderProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const isHome   = pathname === '/'

  /**
   * Smart back navigation — does NOT push a new history entry.
   *
   * Problem with the old `<Link href={backHref}>`: clicking it pushed `/events/concerts`
   * onto the history stack, so the browser required two presses of ← to return home.
   *
   * Fix: use router.back() (which pops the stack, no new entry) when there is
   * navigable history.  Fall back to router.replace() only when the page was opened
   * directly (no in-app history to return to).
   */
  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.replace(backHref ?? '/')
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-[#FAFAFA]/90 backdrop-blur-xl border-b border-[#E5E7EB]">
      <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {showBack ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-[13px] text-[#6B7280] hover:text-[#111111] transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline font-medium">{backLabel ?? 'Back'}</span>
            </button>
          ) : (
            <Link href="/" className="text-[15px] font-bold tracking-tight text-[#111111]">
              NearU
            </Link>
          )}
          {title && !isHome && (
            <>
              {showBack && <span className="text-[#E5E7EB] hidden sm:inline">|</span>}
              <span className="text-[13px] font-medium text-[#374151] truncate hidden sm:block">{title}</span>
            </>
          )}
        </div>

        {/* Center brand on inner pages */}
        {!isHome && showBack && (
          <Link href="/" className="absolute left-1/2 -translate-x-1/2 text-[15px] font-bold tracking-tight text-[#111111] hidden md:block">
            NearU
          </Link>
        )}

        {/* Right */}
        <div className="flex items-center gap-2 shrink-0">
          {children}

          {/* Auth entry points */}
          <AuthButtons />

          {/* Points badge (logged-in only) */}
          <PointsBadge />

          {/* Favorites */}
          <Link href="/favorites"
            className="relative flex items-center justify-center w-9 h-9 rounded-full border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-red-500 hover:border-red-200 transition-all shadow-sm">
            <Heart className="w-4 h-4" />
            <FavCount />
          </Link>

          {/* Submit */}
          <Link href="/submit"
            className="text-[13px] font-semibold bg-[#111111] text-white px-4 py-1.5 rounded-full hover:bg-[#333] transition-colors">
            Submit
          </Link>
        </div>
      </div>
    </header>
  )
}
