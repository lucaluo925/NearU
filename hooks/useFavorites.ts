'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export const DEFAULT_COLLECTIONS = ['Want to try', 'This week', 'Date ideas'] as const
export type CollectionName = (typeof DEFAULT_COLLECTIONS)[number] | string

export interface FavoritesStore {
  /** Per-collection item IDs */
  collections: Record<string, string[]>
  /** Item → collection mapping (first collection for items in multiple) */
  itemCollections: Record<string, string>
}

function emptyStore(): FavoritesStore {
  const collections: Record<string, string[]> = {}
  for (const c of DEFAULT_COLLECTIONS) collections[c] = []
  return { collections, itemCollections: {} }
}

const KEY = 'aggie-map-favorites-v2'
/** Legacy key — flat array */
const LEGACY_KEY = 'aggie-map-favorites'

/**
 * Validate and sanitize a loaded store object.
 * Guards against malformed/partial data in localStorage that could crash the app.
 */
function sanitizeStore(raw: unknown): FavoritesStore {
  const base = emptyStore()

  if (!raw || typeof raw !== 'object') return base

  const obj = raw as Record<string, unknown>

  // Sanitize collections: must be Record<string, string[]>
  const rawCollections = obj.collections
  if (rawCollections && typeof rawCollections === 'object' && !Array.isArray(rawCollections)) {
    const cols = rawCollections as Record<string, unknown>
    for (const key of Object.keys(cols)) {
      const val = cols[key]
      // Each collection value must be an array of strings
      if (Array.isArray(val)) {
        base.collections[key] = val.filter((v): v is string => typeof v === 'string')
      } else {
        // Corrupt entry — reset to empty
        base.collections[key] = []
      }
    }
    // Ensure default collections always exist
    for (const c of DEFAULT_COLLECTIONS) {
      if (!base.collections[c]) base.collections[c] = []
    }
  }

  // Sanitize itemCollections: must be Record<string, string>
  const rawItemCollections = obj.itemCollections
  if (rawItemCollections && typeof rawItemCollections === 'object' && !Array.isArray(rawItemCollections)) {
    const items = rawItemCollections as Record<string, unknown>
    for (const key of Object.keys(items)) {
      const val = items[key]
      if (typeof val === 'string') {
        base.itemCollections[key] = val
      }
      // Invalid entries are dropped
    }
  }

  // Integrity check: ensure itemCollections only reference existing collections
  for (const [itemId, colName] of Object.entries(base.itemCollections)) {
    if (!base.collections[colName]) {
      // Collection was removed but itemCollections still references it — repair
      delete base.itemCollections[itemId]
    }
  }

  return base
}

function loadStore(): FavoritesStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return sanitizeStore(parsed)
    }

    // Migrate from legacy flat array
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const ids: unknown = JSON.parse(legacy)
      const store = emptyStore()
      if (Array.isArray(ids)) {
        const validIds = ids.filter((v): v is string => typeof v === 'string')
        store.collections['Want to try'] = validIds
        for (const id of validIds) store.itemCollections[id] = 'Want to try'
      }
      localStorage.setItem(KEY, JSON.stringify(store))
      localStorage.removeItem(LEGACY_KEY)
      return store
    }
  } catch {
    // Corrupt localStorage — start fresh
  }
  return emptyStore()
}

function saveStore(store: FavoritesStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {}
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFavorites() {
  const [store, setStore] = useState<FavoritesStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setStore(loadStore())
    setHydrated(true)
  }, [])

  /**
   * Stable flat list of all saved item IDs.
   * Memoized so the reference only changes when collections actually change.
   * This prevents useEffect dependency loops in consumers.
   */
  const favorites = useMemo(
    () => Object.values(store.collections).flat(),
    [store.collections],
  )

  /** True when the item is in any collection */
  const isFavorite = useCallback(
    (id: string) => id in store.itemCollections,
    [store.itemCollections],
  )

  /** Which collection an item belongs to (first one) */
  const getCollection = useCallback(
    (id: string) => store.itemCollections[id] ?? null,
    [store.itemCollections],
  )

  /**
   * Toggle an item in a collection.
   * If the item is already in that collection, remove it.
   * If the item is in a different collection, move it.
   * If not in any collection, add it.
   */
  const toggle = useCallback(
    (id: string, collection: string = DEFAULT_COLLECTIONS[0]) => {
      let isNewSave = false
      setStore((prev) => {
        const next: FavoritesStore = {
          collections:     { ...prev.collections },
          itemCollections: { ...prev.itemCollections },
        }
        // Ensure target collection exists
        if (!next.collections[collection]) next.collections[collection] = []

        const currentCollection = prev.itemCollections[id]

        if (currentCollection) {
          // Remove from current collection
          next.collections[currentCollection] = (next.collections[currentCollection] ?? []).filter(
            (i) => i !== id,
          )
          delete next.itemCollections[id]

          // If moving to a different collection, re-add
          if (currentCollection !== collection) {
            next.collections[collection] = [...(next.collections[collection] ?? []), id]
            next.itemCollections[id] = collection
          }
        } else {
          // New save — track so we can award points below
          isNewSave = true
          next.collections[collection] = [...(next.collections[collection] ?? []), id]
          next.itemCollections[id] = collection
        }

        saveStore(next)
        return next
      })

      // Fire-and-forget: points + pet XP for new saves (logged-in users only)
      if (isNewSave) {
        fetch('/api/points/award', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'save_item', metadata: { item_id: id } }),
        }).catch(() => {})
        fetch('/api/pet/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_item' }),
        })
          .then((r) => r.json())
          .then((d: { level_up?: boolean }) => {
            window.dispatchEvent(
              new CustomEvent('pet:react', {
                detail: {
                  type:   d.level_up ? 'celebrate' : 'bounce',
                  action: d.level_up ? undefined : 'save',
                  bond:   3,
                },
              }),
            )
          })
          .catch(() => {
            window.dispatchEvent(
              new CustomEvent('pet:react', {
                detail: { type: 'bounce', action: 'save', bond: 3 },
              }),
            )
          })
      }
    },
    [],
  )

  /** Move an item to a different collection */
  const moveToCollection = useCallback(
    (id: string, targetCollection: string) => {
      setStore((prev) => {
        const next: FavoritesStore = {
          collections:     { ...prev.collections },
          itemCollections: { ...prev.itemCollections },
        }
        if (!next.collections[targetCollection]) next.collections[targetCollection] = []

        const current = prev.itemCollections[id]
        if (current) {
          next.collections[current] = (next.collections[current] ?? []).filter((i) => i !== id)
        }
        next.collections[targetCollection] = [...(next.collections[targetCollection] ?? []), id]
        next.itemCollections[id] = targetCollection

        saveStore(next)
        return next
      })
    },
    [],
  )

  /** Add a new empty custom collection */
  const addCollection = useCallback((name: string) => {
    setStore((prev) => {
      if (prev.collections[name]) return prev
      const next = {
        ...prev,
        collections: { ...prev.collections, [name]: [] },
      }
      saveStore(next)
      return next
    })
  }, [])

  /** Remove a collection and un-save all its items */
  const removeCollection = useCallback((name: string) => {
    setStore((prev) => {
      const next: FavoritesStore = {
        collections:     { ...prev.collections },
        itemCollections: { ...prev.itemCollections },
      }
      const ids = next.collections[name] ?? []
      for (const id of ids) delete next.itemCollections[id]
      delete next.collections[name]
      saveStore(next)
      return next
    })
  }, [])

  return {
    store,
    favorites,
    hydrated,
    isFavorite,
    getCollection,
    toggle,
    moveToCollection,
    addCollection,
    removeCollection,
    collectionNames: Object.keys(store.collections),
  }
}
