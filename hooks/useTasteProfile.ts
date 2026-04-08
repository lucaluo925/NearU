'use client'

/**
 * useTasteProfile
 *
 * Lightweight, fully local user taste profile derived from click behaviour.
 * No server calls, no ML — just localStorage counters that improve scoring
 * over time.
 *
 * Profile is a snapshot: improvements take effect on the *next* page load,
 * not mid-session, which keeps rendering stable.
 */

import { useState, useEffect, useCallback } from 'react'
import type { Item } from '@/lib/types'

const PROFILE_KEY = 'nearu-taste-v1'
const MAX_CLICKS  = 500   // cap stored count to avoid unbounded growth

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TasteProfile {
  /** category slug → click count  */
  categoryCounts:    Record<string, number>
  /** subcategory slug → click count */
  subcategoryCounts: Record<string, number>
  /** lowercase tag → click count */
  tagCounts:         Record<string, number>
  totalClicks:       number
  lastUpdated:       number
  /**
   * Rolling window of the last 10 clicked category slugs, newest first.
   * Used by the recommendation scorer as a recency signal — detects taste
   * shifts faster than aggregate click counts.
   */
  recentCategories:  string[]
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function empty(): TasteProfile {
  return {
    categoryCounts:    {},
    subcategoryCounts: {},
    tagCounts:         {},
    totalClicks:       0,
    lastUpdated:       Date.now(),
    recentCategories:  [],
  }
}

function loadProfile(): TasteProfile {
  if (typeof window === 'undefined') return empty()
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return empty()
    const p = JSON.parse(raw) as Partial<TasteProfile>
    return {
      categoryCounts:    p.categoryCounts    ?? {},
      subcategoryCounts: p.subcategoryCounts ?? {},
      tagCounts:         p.tagCounts         ?? {},
      totalClicks:       p.totalClicks       ?? 0,
      lastUpdated:       p.lastUpdated       ?? Date.now(),
      // Backward-compat: old profiles stored without recentCategories load as []
      recentCategories:  Array.isArray(p.recentCategories)
        ? (p.recentCategories as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
    }
  } catch {
    return empty()
  }
}

// ── Pure utilities (exported for use outside the hook) ────────────────────────

/** Top N keys from a count map, sorted descending by value. */
export function topNKeys(counts: Record<string, number>, n: number): string[] {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([k]) => k)
}

/** Most-clicked category slug, or null if no history. */
export function getDominantTaste(profile: TasteProfile): string | null {
  return topNKeys(profile.categoryCounts, 1)[0] ?? null
}

/** Human-readable taste summary for pet messages. */
export function tasteSummary(profile: TasteProfile): string | null {
  const cat = getDominantTaste(profile)
  if (!cat) return null
  const count = profile.categoryCounts[cat] ?? 0
  if (count < 3) return null            // need at least 3 clicks to make a claim
  const labels: Record<string, string> = {
    food:     'food spots',
    events:   'events',
    outdoor:  'outdoor places',
    study:    'study spots',
    shopping: 'shopping',
    campus:   'campus spots',
  }
  return labels[cat] ?? cat
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTasteProfile() {
  const [profile, setProfile] = useState<TasteProfile>(empty)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage once on mount
  useEffect(() => {
    setProfile(loadProfile())
    setHydrated(true)
  }, [])

  /**
   * Record that the user clicked an item.
   * Increments category, subcategory, and tag counters.
   * Updates localStorage synchronously.
   */
  const recordClick = useCallback((item: Item) => {
    const p = loadProfile()

    p.categoryCounts[item.category] =
      (p.categoryCounts[item.category] ?? 0) + 1

    if (item.subcategory) {
      p.subcategoryCounts[item.subcategory] =
        (p.subcategoryCounts[item.subcategory] ?? 0) + 1
    }

    for (const tag of (item.tags ?? [])) {
      const t = tag.toLowerCase()
      p.tagCounts[t] = (p.tagCounts[t] ?? 0) + 1
    }

    // Rolling window of last 10 clicked categories (newest first).
    // Prepend the current category; trim to 10 to keep the array bounded.
    p.recentCategories = [item.category, ...(p.recentCategories ?? [])].slice(0, 10)

    p.totalClicks  = Math.min((p.totalClicks ?? 0) + 1, MAX_CLICKS)
    p.lastUpdated  = Date.now()

    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {}
    setProfile({ ...p })
  }, [])

  return { profile, hydrated, recordClick }
}
