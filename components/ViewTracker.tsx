'use client'

import { useEffect } from 'react'
import { recordDetailView } from '@/lib/session-seen'

const CAT_SIGNAL_KEY = 'nearu-cat-signal'
const PET_CONTEXT_KEY = 'nearu-pet-context'
const MAX_SIGNAL      = 5

/**
 * ViewTracker — fires the server-side view log and also maintains a local
 * category signal so the pet can make behavior-aware recommendations.
 *
 * The category signal is a most-recent-first array of up to 5 category slugs
 * stored in localStorage. The pet recommendation component reads it to prefer
 * items in categories the user has been exploring.
 *
 * Also writes the current listing's context (id, title, category) so the pet
 * assistant can show relevant items when the user opens the modal on a listing page.
 *
 * recordDetailView() is called here — on confirmed page mount — rather than
 * only on card click. This is the correct signal: the user navigated to the
 * listing and the page loaded successfully.  Calling it here means:
 *   - Card click → landing aborted (back button, 404) = NOT recorded ✓
 *   - Card click → page loads = recorded exactly once ✓
 *   - Direct URL visit = recorded ✓
 * recordDetailView is idempotent within a session so duplicate calls are no-ops.
 */
export default function ViewTracker({ itemId, category, title }: { itemId: string; category?: string; title?: string }) {
  useEffect(() => {
    // Record confirmed detail view for impression-penalty protection.
    // Items the user actually opened get half the impression penalty so they
    // are not rotated out of the feed while the user is still considering them.
    recordDetailView(itemId)

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

      // Write current listing context for pet assistant modal continuity
      try {
        localStorage.setItem(PET_CONTEXT_KEY, JSON.stringify({
          itemId,
          itemTitle:    title ?? null,
          itemCategory: category,
        }))
      } catch {}
    }
  }, [itemId, category, title])

  return null
}
