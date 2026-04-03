'use client'

import { useEffect } from 'react'

const CAT_SIGNAL_KEY = 'nearu-cat-signal'
const MAX_SIGNAL     = 5

/**
 * ViewTracker — fires the server-side view log and also maintains a local
 * category signal so the pet can make behavior-aware recommendations.
 *
 * The category signal is a most-recent-first array of up to 5 category slugs
 * stored in localStorage. The pet recommendation component reads it to prefer
 * items in categories the user has been exploring.
 */
export default function ViewTracker({ itemId, category }: { itemId: string; category?: string }) {
  useEffect(() => {
    // Server-side view log (unchanged)
    fetch('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, type: 'view' }),
    }).catch(() => {})

    // Write category to behavioral signal (most-recent-first, deduped, capped)
    if (category) {
      try {
        const raw     = localStorage.getItem(CAT_SIGNAL_KEY)
        const current: string[] = raw ? (JSON.parse(raw) as unknown[]).filter((c): c is string => typeof c === 'string') : []
        const updated = [category, ...current.filter((c) => c !== category)].slice(0, MAX_SIGNAL)
        localStorage.setItem(CAT_SIGNAL_KEY, JSON.stringify(updated))
      } catch {}
    }
  }, [itemId, category])

  return null
}
