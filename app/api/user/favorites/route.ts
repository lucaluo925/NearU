import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { limiters, getRequestKey, rateLimitResponse } from '@/lib/rate-limit'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_COLLECTIONS = ['Want to try', 'This week', 'Date ideas'] as const

// ── GET /api/user/favorites ───────────────────────────────────────────────────
// Returns the full FavoritesStore shape for the authenticated user.
//
// Response: { collections: Record<string, string[]>, itemCollections: Record<string, string> }

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServerSupabase()

  try {
    const [favResult, colResult] = await Promise.all([
      supabase
        .from('user_favorites')
        .select('item_id, collection_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('user_collections')
        .select('name')
        .eq('user_id', user.id),
    ])

    if (favResult.error) {
      if (favResult.error.code === '42P01') return NextResponse.json(null, { status: 404 })
      return NextResponse.json({ error: favResult.error.message }, { status: 500 })
    }

    // Build FavoritesStore from DB rows
    const collections: Record<string, string[]> = {}
    for (const c of DEFAULT_COLLECTIONS) collections[c] = []

    // Add custom collections (from user_collections — preserves empty ones)
    for (const col of (colResult.data ?? [])) {
      if (!collections[col.name]) collections[col.name] = []
    }

    const itemCollections: Record<string, string> = {}
    for (const row of (favResult.data ?? [])) {
      // Normalize: skip rows with unexpected nulls (defensive against DB inconsistency)
      if (typeof row.item_id !== 'string' || typeof row.collection_name !== 'string') continue
      if (!collections[row.collection_name]) collections[row.collection_name] = []
      collections[row.collection_name].push(row.item_id)
      itemCollections[row.item_id] = row.collection_name
    }

    // Ensure all collection arrays contain only strings (no nulls)
    for (const key of Object.keys(collections)) {
      collections[key] = collections[key].filter((v) => typeof v === 'string')
    }

    return NextResponse.json({ collections, itemCollections })
  } catch (e: unknown) {
    console.error('[user/favorites GET]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

// ── POST /api/user/favorites ──────────────────────────────────────────────────
// Mutates favorites for the authenticated user.
//
// Actions:
//   { action: 'add',              item_id: string, collection_name: string }
//     → Upserts the item into the given collection (moves it if already saved elsewhere).
//
//   { action: 'remove',           item_id: string }
//     → Removes the item from all collections.
//
//   { action: 'add_collection',   name: string }
//     → Creates an empty custom collection (no-op if already exists).
//
//   { action: 'remove_collection', name: string }
//     → Deletes all items in the collection and the collection record itself.

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 120 per user per minute (rapid save/unsave while browsing)
  const rl = limiters.favorites.check(getRequestKey(req, user.id))
  if (rl.limited) return rateLimitResponse(rl.resetIn)

  let body: {
    action:          'add' | 'remove' | 'add_collection' | 'remove_collection'
    item_id?:        string
    collection_name?: string
    name?:           string
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const supabase = getServerSupabase()

  try {
    // ── add ─────────────────────────────────────────────────────────────────────
    if (body.action === 'add') {
      if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
      const col = body.collection_name ?? 'Want to try'

      const { error } = await supabase
        .from('user_favorites')
        .upsert(
          { user_id: user.id, item_id: body.item_id, collection_name: col },
          { onConflict: 'user_id,item_id' },
        )

      if (error) {
        if (error.code === '42P01') return NextResponse.json({ ok: true, skipped: true })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    // ── remove ──────────────────────────────────────────────────────────────────
    if (body.action === 'remove') {
      if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

      const { error } = await supabase
        .from('user_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('item_id', body.item_id)

      if (error && error.code !== '42P01') {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    // ── add_collection ──────────────────────────────────────────────────────────
    if (body.action === 'add_collection') {
      if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
      if ((DEFAULT_COLLECTIONS as readonly string[]).includes(body.name)) {
        // Default collections are always present — nothing to store
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase
        .from('user_collections')
        .upsert(
          { user_id: user.id, name: body.name },
          { onConflict: 'user_id,name' },
        )

      if (error && error.code !== '42P01') {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    // ── remove_collection ───────────────────────────────────────────────────────
    if (body.action === 'remove_collection') {
      if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

      // Delete all items in this collection, then delete the collection record
      await Promise.all([
        supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('collection_name', body.name),
        supabase
          .from('user_collections')
          .delete()
          .eq('user_id', user.id)
          .eq('name', body.name),
      ])

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[user/favorites POST]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
