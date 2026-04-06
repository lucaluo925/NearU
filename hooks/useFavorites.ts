'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

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

const KEY        = 'aggie-map-favorites-v2'
const LEGACY_KEY = 'aggie-map-favorites'

// ── localStorage helpers ──────────────────────────────────────────────────────

/**
 * Validate and sanitize a loaded store object.
 * Guards against malformed/partial data in localStorage that could crash the app.
 */
function sanitizeStore(raw: unknown): FavoritesStore {
  const base = emptyStore()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>

  const rawCollections = obj.collections
  if (rawCollections && typeof rawCollections === 'object' && !Array.isArray(rawCollections)) {
    const cols = rawCollections as Record<string, unknown>
    for (const key of Object.keys(cols)) {
      const val = cols[key]
      if (Array.isArray(val)) {
        base.collections[key] = val.filter((v): v is string => typeof v === 'string')
      } else {
        base.collections[key] = []
      }
    }
    for (const c of DEFAULT_COLLECTIONS) {
      if (!base.collections[c]) base.collections[c] = []
    }
  }

  const rawItemCollections = obj.itemCollections
  if (rawItemCollections && typeof rawItemCollections === 'object' && !Array.isArray(rawItemCollections)) {
    const items = rawItemCollections as Record<string, unknown>
    for (const key of Object.keys(items)) {
      const val = items[key]
      if (typeof val === 'string') base.itemCollections[key] = val
    }
  }

  // Integrity: itemCollections must only reference existing collections
  for (const [itemId, colName] of Object.entries(base.itemCollections)) {
    if (!base.collections[colName]) delete base.itemCollections[itemId]
  }

  return base
}

function lsLoad(): FavoritesStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return sanitizeStore(JSON.parse(raw))

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
  } catch {}
  return emptyStore()
}

function lsSave(store: FavoritesStore) {
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch {}
}

// ── Server API helpers (fire-and-forget unless noted) ─────────────────────────

function apiAdd(itemId: string, collectionName: string) {
  fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'add', item_id: itemId, collection_name: collectionName }),
  }).catch(() => {})
}

function apiRemove(itemId: string) {
  fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'remove', item_id: itemId }),
  }).catch(() => {})
}

function apiAddCollection(name: string) {
  fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'add_collection', name }),
  }).catch(() => {})
}

function apiRemoveCollection(name: string) {
  fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'remove_collection', name }),
  }).catch(() => {})
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFavorites() {
  const [store,    setStore]    = useState<FavoritesStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)

  /**
   * loggedIn ref — set once the server auth check resolves.
   * null = unknown (pending), true = authenticated, false = guest.
   */
  const loggedIn = useRef<boolean | null>(null)

  // ── Mount: load localStorage then sync from server ──────────────────────────
  useEffect(() => {
    // 1. Instant hydration from localStorage
    const ls = lsLoad()
    setStore(ls)
    setHydrated(true)

    // 2. Try to pull from Supabase
    fetch('/api/user/favorites')
      .then(async (r) => {
        if (r.status === 401) {
          loggedIn.current = false
          return
        }
        loggedIn.current = true

        if (r.status === 404 || !r.ok) {
          // Table not ready or no server row yet.
          // Push local favorites up so the server catches up.
          const localItems = Object.entries(ls.itemCollections)
          if (localItems.length > 0) {
            // Upsert each saved item (sequential to avoid rate-limiting)
            for (const [itemId, colName] of localItems) {
              apiAdd(itemId, colName)
            }
          }
          return
        }

        const data = await r.json() as FavoritesStore | null
        if (!data) return

        // Server data is source of truth — replace local state and update cache
        setStore(data)
        lsSave(data)
      })
      .catch(() => {
        loggedIn.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const favorites = useMemo(
    () => Object.values(store.collections).flat(),
    [store.collections],
  )

  const isFavorite = useCallback(
    (id: string) => id in store.itemCollections,
    [store.itemCollections],
  )

  const getCollection = useCallback(
    (id: string) => store.itemCollections[id] ?? null,
    [store.itemCollections],
  )

  // ── toggle ──────────────────────────────────────────────────────────────────

  const toggle = useCallback(
    (id: string, collection: string = DEFAULT_COLLECTIONS[0]) => {
      let isNewSave = false

      setStore((prev) => {
        const next: FavoritesStore = {
          collections:     { ...prev.collections },
          itemCollections: { ...prev.itemCollections },
        }
        if (!next.collections[collection]) next.collections[collection] = []

        const currentCollection = prev.itemCollections[id]

        if (currentCollection) {
          // Remove from current collection
          next.collections[currentCollection] = (next.collections[currentCollection] ?? []).filter(
            (i) => i !== id,
          )
          delete next.itemCollections[id]

          if (currentCollection !== collection) {
            // Move to target collection
            next.collections[collection] = [...(next.collections[collection] ?? []), id]
            next.itemCollections[id]     = collection
            if (loggedIn.current) apiAdd(id, collection)
          } else {
            // Removed from same collection
            if (loggedIn.current) apiRemove(id)
          }
        } else {
          // New save
          isNewSave = true
          next.collections[collection] = [...(next.collections[collection] ?? []), id]
          next.itemCollections[id]     = collection
          if (loggedIn.current) apiAdd(id, collection)
        }

        lsSave(next)
        return next
      })

      // Fire-and-forget: points + pet XP for new saves (logged-in users only)
      if (isNewSave) {
        fetch('/api/points/award', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ type: 'save_item', metadata: { item_id: id } }),
        }).catch(() => {})

        fetch('/api/pet/xp', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'save_item' }),
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

  // ── moveToCollection ────────────────────────────────────────────────────────

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
        next.itemCollections[id]           = targetCollection

        lsSave(next)
        if (loggedIn.current) apiAdd(id, targetCollection)
        return next
      })
    },
    [],
  )

  // ── addCollection ───────────────────────────────────────────────────────────

  const addCollection = useCallback((name: string) => {
    setStore((prev) => {
      if (prev.collections[name]) return prev
      const next = {
        ...prev,
        collections: { ...prev.collections, [name]: [] },
      }
      lsSave(next)
      if (loggedIn.current) apiAddCollection(name)
      return next
    })
  }, [])

  // ── removeCollection ────────────────────────────────────────────────────────

  const removeCollection = useCallback((name: string) => {
    setStore((prev) => {
      const next: FavoritesStore = {
        collections:     { ...prev.collections },
        itemCollections: { ...prev.itemCollections },
      }
      const ids = next.collections[name] ?? []
      for (const id of ids) delete next.itemCollections[id]
      delete next.collections[name]
      lsSave(next)
      if (loggedIn.current) apiRemoveCollection(name)
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
