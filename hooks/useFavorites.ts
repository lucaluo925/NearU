'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export const DEFAULT_COLLECTIONS = ['Want to try', 'This week', 'Date ideas'] as const
export type CollectionName = (typeof DEFAULT_COLLECTIONS)[number] | string

export interface FavoritesStore {
  /** Per-collection item IDs */
  collections: Record<string, string[]>
  /** Item → collection mapping */
  itemCollections: Record<string, string>
}

function emptyStore(): FavoritesStore {
  const collections: Record<string, string[]> = {}
  for (const c of DEFAULT_COLLECTIONS) collections[c] = []
  return { collections, itemCollections: {} }
}

// ── Keys ──────────────────────────────────────────────────────────────────────
// For logged-in users KEY is a fast-hydration cache only; Supabase is truth.
// For guests KEY remains the authoritative store.

const KEY        = 'aggie-map-favorites-v2'
const LEGACY_KEY = 'aggie-map-favorites'  // flat-array legacy format

// ── localStorage helpers ──────────────────────────────────────────────────────

function sanitizeStore(raw: unknown): FavoritesStore {
  const base = emptyStore()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>

  const rawCollections = obj.collections
  if (rawCollections && typeof rawCollections === 'object' && !Array.isArray(rawCollections)) {
    const cols = rawCollections as Record<string, unknown>
    for (const key of Object.keys(cols)) {
      const val = cols[key]
      base.collections[key] = Array.isArray(val)
        ? val.filter((v): v is string => typeof v === 'string')
        : []
    }
    for (const c of DEFAULT_COLLECTIONS) {
      if (!base.collections[c]) base.collections[c] = []
    }
  }

  const rawItemCollections = obj.itemCollections
  if (rawItemCollections && typeof rawItemCollections === 'object' && !Array.isArray(rawItemCollections)) {
    const items = rawItemCollections as Record<string, unknown>
    for (const key of Object.keys(items)) {
      if (typeof items[key] === 'string') base.itemCollections[key] = items[key] as string
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

    // One-time migration from legacy flat-array format
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

// ── Retry-safe fire-and-forget POST ──────────────────────────────────────────
// Does not block the UI. On failure, retries once after 1 s.

function safePost(fn: () => Promise<Response>): void {
  fn().catch(() => setTimeout(() => fn().catch(() => {}), 1_000))
}

// ── Server API helpers ────────────────────────────────────────────────────────
// A single upsert (action: 'add') handles both new saves and moves —
// the DB UNIQUE(user_id, item_id) constraint ensures the item stays in
// exactly one collection. No double API calls needed.

function apiAdd(itemId: string, collectionName: string) {
  safePost(() => fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'add', item_id: itemId, collection_name: collectionName }),
  }))
}

function apiRemove(itemId: string) {
  safePost(() => fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'remove', item_id: itemId }),
  }))
}

function apiAddCollection(name: string) {
  safePost(() => fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'add_collection', name }),
  }))
}

function apiRemoveCollection(name: string) {
  safePost(() => fetch('/api/user/favorites', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'remove_collection', name }),
  }))
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFavorites() {
  const [store,    setStore]    = useState<FavoritesStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)

  // ── Refs ──────────────────────────────────────────────────────────────────
  //
  // lastLocalUpdateRef: timestamp of last LOCAL mutation or cross-tab storage
  //   event. If a server sync response arrives with a start-time earlier than
  //   this, it is stale and we skip the state overwrite.
  //
  // loggedIn: null = auth unknown, true = authenticated, false = guest.
  const lastLocalUpdateRef = useRef(0)
  const loggedIn           = useRef<boolean | null>(null)

  // ── Mount: localStorage → server sync ────────────────────────────────────
  useEffect(() => {
    // Step 1: Instant hydration from localStorage.
    const ls = lsLoad()
    setStore(ls)
    setHydrated(true)

    // Step 2: Async server sync.
    const fetchStart = Date.now()

    fetch('/api/user/favorites')
      .then(async (r) => {
        if (r.status === 401) {
          // Guest — localStorage is truth for this session.
          loggedIn.current = false
          return
        }
        loggedIn.current = true

        if (r.status === 404 || !r.ok) {
          // No server data yet. Promote local favorites to Supabase.
          for (const [itemId, colName] of Object.entries(ls.itemCollections)) {
            apiAdd(itemId, colName)
          }
          return
        }

        // ── Race guard ──────────────────────────────────────────────────────
        if (lastLocalUpdateRef.current > fetchStart) return

        const data = await r.json() as FavoritesStore | null
        if (!data) return

        // Normalize: ensure default collections always exist
        const normalized = sanitizeStore(data)
        setStore(normalized)
        lsSave(normalized)

        // Clean up legacy key now that Supabase is confirmed as the source
        try { localStorage.removeItem(LEGACY_KEY) } catch {}
      })
      .catch(() => {
        loggedIn.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Multi-tab sync ───────────────────────────────────────────────────────
  // When another tab writes to localStorage, sync this tab's state.
  // Treat it as a local update so any in-flight server fetch won't clobber it.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY && e.newValue !== null) {
        try {
          const parsed = sanitizeStore(JSON.parse(e.newValue))
          lastLocalUpdateRef.current = Date.now()
          setStore(parsed)
        } catch {}
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────────

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

  // ── toggle ───────────────────────────────────────────────────────────────
  // Enforces one-collection-per-item: removes from old collection before
  // adding to new one. A single API call (upsert) handles both add and move.

  const toggle = useCallback(
    (id: string, collection: string = DEFAULT_COLLECTIONS[0]) => {
      // Determine the action BEFORE calling setStore so we can run API calls
      // and effects outside the functional updater (safe in concurrent mode).
      let apiAction: 'add' | 'remove' | null = null
      let isNewSave = false

      lastLocalUpdateRef.current = Date.now()

      setStore((prev) => {
        const next: FavoritesStore = {
          collections:     { ...prev.collections },
          itemCollections: { ...prev.itemCollections },
        }
        if (!next.collections[collection]) next.collections[collection] = []

        const currentCollection = prev.itemCollections[id]

        if (currentCollection) {
          // Remove from current collection
          next.collections[currentCollection] = (next.collections[currentCollection] ?? [])
            .filter((i) => i !== id)
          delete next.itemCollections[id]

          if (currentCollection !== collection) {
            // Move to target — single upsert handles it on the server
            next.collections[collection] = [...(next.collections[collection] ?? []), id]
            next.itemCollections[id]     = collection
            apiAction = 'add'  // upsert updates collection_name via UNIQUE conflict
          } else {
            // Toggled off
            apiAction = 'remove'
          }
        } else {
          // New save
          isNewSave = true
          apiAction = 'add'
          next.collections[collection] = [...(next.collections[collection] ?? []), id]
          next.itemCollections[id]     = collection
        }

        lsSave(next)
        return next
      })

      // ── API writes (outside updater — safe in strict/concurrent mode) ─────
      if (loggedIn.current) {
        if (apiAction === 'add')    apiAdd(id, collection)
        if (apiAction === 'remove') apiRemove(id)
      }

      // ── Analytics + rewards for genuinely new saves ───────────────────────
      if (isNewSave) {
        console.log('[analytics] favorite_added', { item_id: id, collection })

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
                  action: d.level_up ? undefined    : 'save',
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

  // ── moveToCollection ─────────────────────────────────────────────────────
  // Moves item to a different collection. One API call (upsert).

  const moveToCollection = useCallback(
    (id: string, targetCollection: string) => {
      lastLocalUpdateRef.current = Date.now()

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
        return next
      })

      // Single upsert — the DB UNIQUE constraint ensures no duplicates
      if (loggedIn.current) apiAdd(id, targetCollection)
    },
    [],
  )

  // ── addCollection ────────────────────────────────────────────────────────

  const addCollection = useCallback((name: string) => {
    let isNew = false

    lastLocalUpdateRef.current = Date.now()

    setStore((prev) => {
      if (prev.collections[name]) return prev
      isNew = true
      const next = {
        ...prev,
        collections: { ...prev.collections, [name]: [] },
      }
      lsSave(next)
      return next
    })

    if (isNew) {
      console.log('[analytics] collection_created', { name })
      if (loggedIn.current) apiAddCollection(name)
    }
  }, [])

  // ── removeCollection ─────────────────────────────────────────────────────

  const removeCollection = useCallback((name: string) => {
    lastLocalUpdateRef.current = Date.now()

    setStore((prev) => {
      const next: FavoritesStore = {
        collections:     { ...prev.collections },
        itemCollections: { ...prev.itemCollections },
      }
      const ids = next.collections[name] ?? []
      for (const id of ids) delete next.itemCollections[id]
      delete next.collections[name]
      lsSave(next)
      return next
    })

    // API call outside the updater — safe in concurrent mode
    if (loggedIn.current) apiRemoveCollection(name)
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
