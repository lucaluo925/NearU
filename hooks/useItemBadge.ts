'use client'

import { useState, useEffect } from 'react'

type Badge = 'trending' | 'popular' | null

// Module-level cache — fetched once per page load
let loaded = false
let loading = false
const trendingIds = new Set<string>()
const popularIds  = new Set<string>()
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((fn) => fn())
}

async function ensureLoaded() {
  if (loaded || loading) return
  loading = true
  try {
    const res = await fetch('/api/popular?ids_only=1')
    if (res.ok) {
      const { trending, popular } = await res.json()
      ;(trending ?? []).forEach((id: string) => trendingIds.add(id))
      ;(popular  ?? []).forEach((id: string) => popularIds.add(id))
    }
  } catch {}
  loaded = true
  loading = false
  notify()
}

export function useItemBadge(id: string): Badge {
  const [, rerender] = useState(0)

  useEffect(() => {
    if (!loaded) {
      const fn = () => rerender((n) => n + 1)
      subscribers.add(fn)
      ensureLoaded()
      return () => { subscribers.delete(fn) }
    }
  }, [])

  if (trendingIds.has(id)) return 'trending'
  if (popularIds.has(id))  return 'popular'
  return null
}
