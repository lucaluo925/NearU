'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const KEY       = 'aggie-map-interests'
const SHOWN_KEY = 'aggie-map-interests-shown'

export interface InterestsStore {
  cuisines:   string[]
  vibes:      string[]
  prices:     string[]
  /** Category preferences: events, food, etc. */
  categories: string[]
}

function emptyInterests(): InterestsStore {
  return { cuisines: [], vibes: [], prices: [], categories: [] }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsLoad(): { interests: InterestsStore; shown: boolean } {
  try {
    const raw   = localStorage.getItem(KEY)
    const shown = localStorage.getItem(SHOWN_KEY) === '1'
    return { interests: raw ? (JSON.parse(raw) as InterestsStore) : emptyInterests(), shown }
  } catch {
    return { interests: emptyInterests(), shown: false }
  }
}

function lsSave(interests: InterestsStore, shown: boolean) {
  try {
    localStorage.setItem(KEY,      JSON.stringify(interests))
    localStorage.setItem(SHOWN_KEY, shown ? '1' : '')
  } catch {}
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInterests() {
  const [interests, setInterests]               = useState<InterestsStore>(emptyInterests)
  const [hydrated,  setHydrated]                = useState(false)
  const [shouldShowOnboarding, setShouldShow]   = useState(false)

  /**
   * loggedIn ref — set once the server confirms auth.
   * Used by save/dismiss to decide whether to also push to the API.
   * Starts as null (unknown), becomes true/false after the first GET resolves.
   */
  const loggedIn = useRef<boolean | null>(null)

  // ── Mount: load localStorage, then sync from server ────────────────────────
  useEffect(() => {
    // 1. Instant hydration from localStorage (works for guests too)
    const { interests: ls, shown } = lsLoad()
    setInterests(ls)
    if (!shown) setShouldShow(true)
    setHydrated(true)

    // 2. Try to pull from Supabase (logged-in users only)
    fetch('/api/user/interests')
      .then(async (r) => {
        if (r.status === 401) {
          // Not logged in — guest mode, localStorage is the truth
          loggedIn.current = false
          return
        }
        loggedIn.current = true

        if (r.status === 404 || !r.ok) {
          // Table not ready or user has no server-side row yet.
          // If we have local interests, push them up so the server catches up.
          const hasLocal =
            ls.cuisines.length   > 0 ||
            ls.vibes.length      > 0 ||
            ls.prices.length     > 0 ||
            ls.categories.length > 0
          if (hasLocal) {
            fetch('/api/user/interests', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ ...ls, shown }),
            }).catch(() => {})
          }
          return
        }

        const data = await r.json() as (InterestsStore & { shown: boolean }) | null
        if (!data) return

        // Server data wins — replace local state and update localStorage cache
        const serverInterests: InterestsStore = {
          cuisines:   data.cuisines   ?? [],
          vibes:      data.vibes      ?? [],
          prices:     data.prices     ?? [],
          categories: data.categories ?? [],
        }
        setInterests(serverInterests)
        setShouldShow(!data.shown)
        lsSave(serverInterests, data.shown ?? false)
      })
      .catch(() => {
        // Network error — stay on localStorage
        loggedIn.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── save: persist interests (onboarding complete) ───────────────────────────
  const save = useCallback((next: InterestsStore) => {
    setInterests(next)
    lsSave(next, true)
    setShouldShow(false)

    if (loggedIn.current) {
      fetch('/api/user/interests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...next, shown: true }),
      }).catch(() => {})
    }
  }, [])

  // ── dismiss: mark onboarding as seen without saving preferences ─────────────
  const dismiss = useCallback(() => {
    try { localStorage.setItem(SHOWN_KEY, '1') } catch {}
    setShouldShow(false)

    if (loggedIn.current) {
      // Persist current interests with shown=true
      setInterests((current) => {
        fetch('/api/user/interests', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...current, shown: true }),
        }).catch(() => {})
        return current
      })
    }
  }, [])

  const hasInterests =
    interests.cuisines.length   > 0 ||
    interests.vibes.length      > 0 ||
    interests.prices.length     > 0 ||
    interests.categories.length > 0

  /** All selected tags flattened */
  const allTags = [
    ...interests.cuisines,
    ...interests.vibes,
    ...interests.prices,
  ]

  return {
    interests,
    allTags,
    hasInterests,
    hydrated,
    shouldShowOnboarding,
    save,
    dismiss,
  }
}
