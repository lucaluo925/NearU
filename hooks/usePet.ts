'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PetMood } from '@/lib/pet'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PetState {
  pet_type: string
  xp: number
  level: number
  mood: PetMood
  last_action_at: string | null
  unlocked_pets: string[]
  /** Number of unhatched eggs the user currently owns */
  egg_count: number
}

export interface XpResult {
  xp: number
  level: number
  mood: PetMood
  level_up: boolean
  xp_gained: number
}

// ── Standalone XP award (fire-and-forget, no hook required) ──────────────────

export async function awardPetXP(action: string): Promise<XpResult | null> {
  try {
    const r = await fetch('/api/pet/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (r.ok) return await r.json()
  } catch {}
  return null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePet() {
  const [pet, setPet] = useState<PetState | null>(null)
  const [loading, setLoading] = useState(true)
  /** True only when the API explicitly returned 401 — user is not logged in. */
  const [isLoggedOut, setIsLoggedOut] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/pet')
      if (r.ok) {
        setIsLoggedOut(false)
        setPet(await r.json())
      } else if (r.status === 401) {
        // Definitively not logged in — hide the widget
        setIsLoggedOut(true)
        setPet(null)
      }
      // Any other HTTP error: leave pet as-is so the widget can use fallback
    } catch {
      // Network error: leave pet as-is (don't set null — let widget use fallback)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /** Change the active pet type (must already be unlocked) */
  const choosePet = useCallback(async (petType: string) => {
    try {
      const r = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pet_type: petType }),
      })
      if (r.ok) setPet(await r.json())
    } catch {}
  }, [])

  /**
   * Unlock a new pet type by spending points.
   * Returns { ok, current_points } or { ok: false, error }.
   */
  const unlockPet = useCallback(async (
    petType: string,
  ): Promise<{ ok: boolean; current_points?: number; error?: string }> => {
    try {
      const r = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', pet_type: petType }),
      })
      const data = await r.json()
      if (!r.ok) return { ok: false, error: data?.error ?? 'unlock failed' }
      // Optimistically update local unlocked_pets list
      if (data.unlocked_pets) {
        setPet((prev) => prev ? { ...prev, unlocked_pets: data.unlocked_pets } : prev)
      }
      return { ok: true, current_points: data.current_points }
    } catch {
      return { ok: false, error: 'network error' }
    }
  }, [])

  /**
   * Buy a Pet Egg by spending EGG_PRICE points.
   * Returns { ok, egg_count, current_points } or { ok: false, error }.
   */
  const buyEgg = useCallback(async (): Promise<{ ok: boolean; egg_count?: number; current_points?: number; error?: string }> => {
    try {
      const r = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy_egg' }),
      })
      const data = await r.json()
      if (!r.ok) return { ok: false, error: data?.error ?? 'purchase failed' }
      // Optimistically update egg_count in local state
      if (data.egg_count != null) {
        setPet((prev) => prev ? { ...prev, egg_count: data.egg_count } : prev)
      }
      return { ok: true, egg_count: data.egg_count, current_points: data.current_points }
    } catch {
      return { ok: false, error: 'network error' }
    }
  }, [])

  /**
   * Hatch one egg — decrement egg_count, unlock + activate drawn pet.
   * Returns updated PetState or { ok: false, error }.
   */
  const hatchEgg = useCallback(async (
    drawnPetType: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hatch', pet_type: drawnPetType }),
      })
      const data = await r.json()
      if (!r.ok) return { ok: false, error: data?.error ?? 'hatch failed' }
      if (data.pet) setPet(data.pet)
      return { ok: true }
    } catch {
      return { ok: false, error: 'network error' }
    }
  }, [])

  /**
   * Award XP locally and refresh state.
   * Optimistically updates the level_up state if detected.
   */
  const addXP = useCallback(async (action: string): Promise<XpResult | null> => {
    const result = await awardPetXP(action)
    if (result) {
      setPet((prev) =>
        prev
          ? { ...prev, xp: result.xp, level: result.level, mood: result.mood }
          : prev,
      )
    }
    return result
  }, [])

  return { pet, loading, isLoggedOut, refresh, choosePet, unlockPet, addXP, buyEgg, hatchEgg }
}
