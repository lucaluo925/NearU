'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ── Keys ──────────────────────────────────────────────────────────────────────
// For logged-in users these are a fast-hydration cache only; Supabase is truth.
// For guests they remain the authoritative store (unchanged behavior).

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
    return {
      interests: raw ? (JSON.parse(raw) as InterestsStore) : emptyInterests(),
      shown,
    }
  } catch {
    return { interests: emptyInterests(), shown: false }
  }
}

function lsSave(interests: InterestsStore, shown: boolean) {
  try {
    localStorage.setItem(KEY,       JSON.stringify(interests))
    localStorage.setItem(SHOWN_KEY, shown ? '1' : '')
  } catch {}
}

// ── Retry-safe fire-and-forget POST ──────────────────────────────────────────
// Does not block the UI. On failure, retries once after 1 s.

function safePost(fn: () => Promise<Response>): void {
  fn().catch(() => setTimeout(() => fn().catch(() => {}), 1_000))
}

// ── Normalize server response ─────────────────────────────────────────────────
// Defensive against any nulls or wrong types in the DB response.

function normalizeInterests(data: unknown): (InterestsStore & { shown: boolean }) | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  return {
    cuisines:   Array.isArray(d.cuisines)   ? (d.cuisines   as string[]) : [],
    vibes:      Array.isArray(d.vibes)      ? (d.vibes      as string[]) : [],
    prices:     Array.isArray(d.prices)     ? (d.prices     as string[]) : [],
    categories: Array.isArray(d.categories) ? (d.categories as string[]) : [],
    shown:      typeof d.shown === 'boolean' ? d.shown : false,
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInterests() {
  const [interests, setInterests]             = useState<InterestsStore>(emptyInterests)
  const [hydrated,  setHydrated]              = useState(false)
  const [shouldShowOnboarding, setShouldShow] = useState(false)

  // ── Refs ──────────────────────────────────────────────────────────────────
  //
  // lastLocalUpdateRef: timestamp of the last LOCAL mutation (user action or
  //   cross-tab storage event). Used to detect stale server responses: if the
  //   user mutated state AFTER the server fetch started, we skip the overwrite.
  //
  // loggedIn: null = auth unknown (pending), true = authenticated, false = guest.
  const lastLocalUpdateRef = useRef(0)
  const loggedIn           = useRef<boolean | null>(null)

  // ── Mount: localStorage → server sync ────────────────────────────────────
  useEffect(() => {
    // Step 1: Instant hydration from localStorage (works for guests / SSR).
    const { interests: ls, shown } = lsLoad()
    setInterests(ls)
    if (!shown) setShouldShow(true)
    setHydrated(true)

    // Step 2: Async server sync. Record when the fetch started so we can
    //         detect user mutations that happen while it is in-flight.
    const fetchStart = Date.now()

    fetch('/api/user/interests')
      .then(async (r) => {
        if (r.status === 401) {
          // Guest — localStorage is the truth for this session.
          loggedIn.current = false
          return
        }
        loggedIn.current = true

        if (r.status === 404 || !r.ok) {
          // No server row yet. Promote local data so Supabase catches up.
          const hasLocal =
            ls.cuisines.length   > 0 ||
            ls.vibes.length      > 0 ||
            ls.prices.length     > 0 ||
            ls.categories.length > 0
          if (hasLocal) {
            safePost(() => fetch('/api/user/interests', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ ...ls, shown }),
            }))
          }
          return
        }

        // ── Race guard ──────────────────────────────────────────────────────
        // If the user mutated state after this fetch was initiated, the
        // server response is stale — discard it so we don't lose their changes.
        if (lastLocalUpdateRef.current > fetchStart) return

        const normalized = normalizeInterests(await r.json())
        if (!normalized) return

        setInterests(normalized)
        setShouldShow(!normalized.shown)
        lsSave(normalized, normalized.shown)
      })
      .catch(() => {
        // Network failure — stay on localStorage data.
        loggedIn.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Multi-tab sync ───────────────────────────────────────────────────────
  // When another tab writes to localStorage, keep this tab's state in sync.
  // Mark as a local update so any in-flight server fetch won't clobber it.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY && e.newValue !== null) {
        try {
          const parsed = JSON.parse(e.newValue) as InterestsStore
          lastLocalUpdateRef.current = Date.now()
          setInterests(parsed)
        } catch {}
      }
      if (e.key === SHOWN_KEY) {
        setShouldShow(e.newValue !== '1')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // ── save ─────────────────────────────────────────────────────────────────
  const save = useCallback((next: InterestsStore) => {
    // Mark local mutation BEFORE setState so the race guard timestamp is correct.
    lastLocalUpdateRef.current = Date.now()
    setInterests(next)
    lsSave(next, true)
    setShouldShow(false)

    console.log('[analytics] interest_set', {
      cuisines_count:   next.cuisines.length,
      vibes_count:      next.vibes.length,
      prices_count:     next.prices.length,
      categories_count: next.categories.length,
    })

    if (loggedIn.current) {
      safePost(() => fetch('/api/user/interests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...next, shown: true }),
      }))
    }
  }, [])

  // ── dismiss ───────────────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    lastLocalUpdateRef.current = Date.now()
    try { localStorage.setItem(SHOWN_KEY, '1') } catch {}
    setShouldShow(false)

    if (loggedIn.current) {
      // Read current interests out of state to include in the POST.
      setInterests((current) => {
        safePost(() => fetch('/api/user/interests', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...current, shown: true }),
        }))
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
