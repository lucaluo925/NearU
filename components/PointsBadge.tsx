'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'

/**
 * PointsBadge — shows the logged-in user's current point balance.
 * Links to /rewards. Hidden when not authenticated.
 */
export default function PointsBadge() {
  const [points, setPoints] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createBrowserSupabase()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      try {
        const r = await fetch('/api/points')
        if (r.ok) {
          const d = await r.json()
          setPoints(d.current_points ?? 0)
        }
      } catch {}
    }
    load()
  }, [])

  if (points === null) return null

  return (
    <Link
      href="/rewards"
      title="Your points — view rewards"
      className="flex items-center gap-1 text-[12px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 transition-colors"
    >
      <Zap className="w-3 h-3 fill-amber-500 text-amber-500" />
      {points}
    </Link>
  )
}
