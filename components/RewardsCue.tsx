'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'

/**
 * RewardsCue — subtle homepage hint about the points system.
 * Logged-in: shows live point balance + link.
 * Logged-out: shows generic teaser.
 */
export default function RewardsCue() {
  const [points, setPoints] = useState<number | null>(null)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedIn(!!session)
      if (!session) return
      fetch('/api/points')
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) setPoints(d.current_points) })
        .catch(() => {})
    })
  }, [])

  // Don't render until auth is resolved (avoids flash)
  if (loggedIn === null) return null

  return (
    <div className="flex items-center justify-between gap-3 mt-2.5 px-0.5">
      {loggedIn && points !== null ? (
        <p className="text-[12px] text-[#9CA3AF]">
          <span className="font-semibold text-amber-600">{points} pts</span>
          {' '}— keep saving &amp; sharing to earn more
        </p>
      ) : (
        <p className="text-[12px] text-[#9CA3AF] flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
          Earn points. Unlock your style.
        </p>
      )}
      <Link
        href="/rewards"
        className="text-[12px] font-semibold text-amber-600 hover:text-amber-700 transition-colors shrink-0"
      >
        Rewards →
      </Link>
    </div>
  )
}
