'use client'

import { useState, useEffect, useCallback } from 'react'

const KEY     = 'aggie-map-interests'
const SHOWN_KEY = 'aggie-map-interests-shown'

export interface InterestsStore {
  cuisines: string[]
  vibes:    string[]
  prices:   string[]
  /** Category preferences: events, food, etc. */
  categories: string[]
}

function emptyInterests(): InterestsStore {
  return { cuisines: [], vibes: [], prices: [], categories: [] }
}

export function useInterests() {
  const [interests, setInterests] = useState<InterestsStore>(emptyInterests)
  const [hydrated, setHydrated] = useState(false)
  /** True when the onboarding has never been shown */
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setInterests(JSON.parse(raw) as InterestsStore)
    } catch {}

    // Show onboarding if not yet shown
    const shown = localStorage.getItem(SHOWN_KEY)
    if (!shown) setShouldShowOnboarding(true)

    setHydrated(true)
  }, [])

  const save = useCallback((next: InterestsStore) => {
    setInterests(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      localStorage.setItem(SHOWN_KEY, '1')
    } catch {}
    setShouldShowOnboarding(false)
  }, [])

  const dismiss = useCallback(() => {
    try { localStorage.setItem(SHOWN_KEY, '1') } catch {}
    setShouldShowOnboarding(false)
  }, [])

  const hasInterests =
    interests.cuisines.length > 0 ||
    interests.vibes.length > 0 ||
    interests.prices.length > 0 ||
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
