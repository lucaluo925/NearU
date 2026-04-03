import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { computeLevel, computeMood, PET_TYPES, PET_PRICES, PET_RARITY, EGG_PRICE, type PetType } from '@/lib/pet'

// ── Shared response builder ───────────────────────────────────────────────────

function buildResponse(row: {
  pet_type: string
  xp: number
  last_action_at: string | null
  unlocked_pets?: string[] | null
  egg_count?: number | null
}) {
  return {
    pet_type:       row.pet_type,
    xp:             row.xp,
    level:          computeLevel(row.xp),
    mood:           computeMood(row.last_action_at),
    last_action_at: row.last_action_at,
    unlocked_pets:  row.unlocked_pets ?? ['dog'],
    egg_count:      row.egg_count     ?? 0,
  }
}

// ── GET /api/pet — fetch (or lazily create) the user's pet ───────────────────

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServerSupabase()

  try {
    const { data, error } = await supabase
      .from('user_pets')
      .select('pet_type, xp, last_action_at, unlocked_pets, egg_count')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') {
      if (error.code === '42P01') {
        // Table not set up yet — return a placeholder so the widget shows
        return NextResponse.json(buildResponse({ pet_type: 'dog', xp: 0, last_action_at: null }))
      }
      throw error
    }

    if (!data) {
      // No pet yet — create a default one
      const { data: newRow, error: insErr } = await supabase
        .from('user_pets')
        .insert({ user_id: user.id, pet_type: 'dog', xp: 0, unlocked_pets: ['dog'], egg_count: 0 })
        .select('pet_type, xp, last_action_at, unlocked_pets, egg_count')
        .single()

      if (insErr) {
        return NextResponse.json(buildResponse({ pet_type: 'dog', xp: 0, last_action_at: null }))
      }
      return NextResponse.json(buildResponse(newRow))
    }

    return NextResponse.json(buildResponse(data))
  } catch (e: unknown) {
    console.error('[pet GET]', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

// ── POST /api/pet ─────────────────────────────────────────────────────────────
//
// Two actions:
//   { pet_type: string }                      → change active pet type
//   { action: 'unlock', pet_type: string }    → spend points to unlock a pet

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pet_type?: string; action?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const supabase = getServerSupabase()

  // ── Unlock a pet ──────────────────────────────────────────────────────────────
  if (body.action === 'unlock') {
    const { pet_type } = body
    if (!pet_type || !PET_TYPES.includes(pet_type as PetType)) {
      return NextResponse.json({ error: 'invalid pet_type' }, { status: 400 })
    }

    const price = PET_PRICES[pet_type as PetType]
    if (price === 0) {
      // Free pet — return as already unlocked
      return NextResponse.json({ ok: true, already_unlocked: true, unlocked_pets: ['dog'] })
    }

    try {
      const [{ data: petRow }, { data: pointsRow }] = await Promise.all([
        supabase.from('user_pets').select('pet_type, xp, last_action_at, unlocked_pets, egg_count').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_points').select('current_points').eq('user_id', user.id).maybeSingle(),
      ])

      const currentPoints: number    = pointsRow?.current_points  ?? 0
      const existingUnlocked: string[] = (petRow?.unlocked_pets as string[] | null) ?? ['dog']

      if (existingUnlocked.includes(pet_type)) {
        return NextResponse.json({ ok: true, already_unlocked: true, unlocked_pets: existingUnlocked })
      }
      if (currentPoints < price) {
        return NextResponse.json(
          { error: `Need ${price} pts (have ${currentPoints})` },
          { status: 402 },
        )
      }

      const newUnlocked = [...existingUnlocked, pet_type]

      // Deduct points + update unlocked_pets + insert ledger entry — all in parallel
      const [rpcResult] = await Promise.all([
        supabase.rpc('increment_user_points', { p_user_id: user.id, p_delta: -price }),
        supabase.from('user_pets').upsert(
          {
            user_id:       user.id,
            pet_type:      petRow?.pet_type ?? 'dog',
            xp:            petRow?.xp       ?? 0,
            unlocked_pets: newUnlocked,
            updated_at:    new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        ),
        supabase.from('point_events').insert({
          user_id:  user.id,
          type:     'unlock_pet',
          points:   -price,
          metadata: { pet_type, cost: String(price) },
        }),
      ])

      const balRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
      return NextResponse.json({
        ok:             true,
        unlocked_pets:  newUnlocked,
        current_points: balRow?.current_points ?? Math.max(0, currentPoints - price),
      })
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err?.code === '42P01') {
        return NextResponse.json({ error: 'Pet system not ready' }, { status: 503 })
      }
      console.error('[pet unlock]', err?.message)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }

  // ── Buy a pet egg ─────────────────────────────────────────────────────────────
  if (body.action === 'buy_egg') {
    try {
      const [{ data: petRow }, { data: pointsRow }] = await Promise.all([
        supabase.from('user_pets').select('pet_type, xp, last_action_at, unlocked_pets, egg_count').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_points').select('current_points').eq('user_id', user.id).maybeSingle(),
      ])

      const currentPoints = pointsRow?.current_points ?? 0
      if (currentPoints < EGG_PRICE) {
        return NextResponse.json(
          { error: `Need ${EGG_PRICE} pts to buy an egg (have ${currentPoints})` },
          { status: 402 },
        )
      }

      const newEggCount = (petRow?.egg_count ?? 0) + 1

      const [rpcResult] = await Promise.all([
        supabase.rpc('increment_user_points', { p_user_id: user.id, p_delta: -EGG_PRICE }),
        supabase.from('user_pets').upsert(
          {
            user_id:       user.id,
            pet_type:      petRow?.pet_type      ?? 'dog',
            xp:            petRow?.xp            ?? 0,
            unlocked_pets: (petRow?.unlocked_pets as string[] | null) ?? ['dog'],
            egg_count:     newEggCount,
            updated_at:    new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        ),
        supabase.from('point_events').insert({
          user_id:  user.id,
          type:     'buy_egg',
          points:   -EGG_PRICE,
          metadata: { cost: String(EGG_PRICE) },
        }),
      ])

      const balRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
      return NextResponse.json({
        ok:             true,
        egg_count:      newEggCount,
        current_points: balRow?.current_points ?? Math.max(0, currentPoints - EGG_PRICE),
      })
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      console.error('[pet buy_egg]', err?.message)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }

  // ── Hatch an egg → draw result, unlock + activate pet, decrement egg_count ──
  if (body.action === 'hatch') {
    const { pet_type: drawnPet } = body as { pet_type?: string }
    if (!drawnPet || !PET_TYPES.includes(drawnPet as PetType)) {
      return NextResponse.json({ error: 'invalid pet_type' }, { status: 400 })
    }

    try {
      const { data: petRow } = await supabase
        .from('user_pets')
        .select('pet_type, xp, last_action_at, unlocked_pets, egg_count')
        .eq('user_id', user.id)
        .maybeSingle()

      const eggCount = petRow?.egg_count ?? 0
      if (eggCount < 1) {
        return NextResponse.json({ error: 'No eggs available' }, { status: 402 })
      }

      const existingUnlocked: string[] = (petRow?.unlocked_pets as string[] | null) ?? ['dog']
      const newUnlocked = existingUnlocked.includes(drawnPet)
        ? existingUnlocked
        : [...existingUnlocked, drawnPet]
      const rarity = PET_RARITY[drawnPet as PetType]

      const { data: updatedRow, error: upErr } = await supabase
        .from('user_pets')
        .upsert(
          {
            user_id:        user.id,
            pet_type:       drawnPet,          // activate hatched pet
            xp:             petRow?.xp         ?? 0,
            last_action_at: petRow?.last_action_at ?? null,
            unlocked_pets:  newUnlocked,
            egg_count:      eggCount - 1,
            updated_at:     new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        .select('pet_type, xp, last_action_at, unlocked_pets, egg_count')
        .single()

      if (upErr) throw upErr

      // Log hatch event (fire-and-forget, non-blocking)
      void supabase.from('point_events').insert({
        user_id:  user.id,
        type:     'hatch_pet',
        points:   0,
        metadata: { pet_type: drawnPet, rarity },
      })

      return NextResponse.json({ ok: true, pet: buildResponse(updatedRow) })
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      console.error('[pet hatch]', err?.message)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }

  // ── Change active pet type ────────────────────────────────────────────────────
  const { pet_type } = body
  if (!pet_type || !PET_TYPES.includes(pet_type as PetType)) {
    return NextResponse.json({ error: 'invalid pet_type' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .from('user_pets')
      .upsert(
        { user_id: user.id, pet_type, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select('pet_type, xp, last_action_at, unlocked_pets, egg_count')
      .single()

    if (error) throw error
    return NextResponse.json(buildResponse(data))
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err?.code === '42P01') {
      return NextResponse.json({ error: 'Pet system not ready' }, { status: 503 })
    }
    console.error('[pet POST]', err?.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
