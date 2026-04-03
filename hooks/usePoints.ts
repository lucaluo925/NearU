'use client'

import { useState, useEffect, useCallback } from 'react'
import { labelForType } from '@/lib/points'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PointEvent {
  id: string
  type: string
  points: number
  label: string
  metadata: Record<string, string>
  created_at: string
}

export interface PointsData {
  current_points: number
  total_points_earned: number
  history: PointEvent[]
}

export interface AwardResult {
  points: number
  current_points: number
  total_points_earned: number
  skipped: boolean
}

// ── Standalone award function (no React state — import in non-hook contexts) ──

export async function awardPoints(
  type: string,
  metadata?: Record<string, string>,
): Promise<AwardResult> {
  try {
    const r = await fetch('/api/points/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, metadata }),
    })
    if (r.ok) return await r.json()
  } catch {}
  return { points: 0, current_points: 0, total_points_earned: 0, skipped: true }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePoints() {
  const [data, setData] = useState<PointsData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/points')
      if (r.ok) {
        setData(await r.json())
      } else if (r.status === 401) {
        // Not logged in — show zero state
        setData({ current_points: 0, total_points_earned: 0, history: [] })
      }
    } catch {
      setData({ current_points: 0, total_points_earned: 0, history: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /**
   * Award points for an action and optimistically update local state.
   * Returns the award result (with points = 0 and skipped = true if deduped).
   */
  const award = useCallback(async (
    type: string,
    metadata?: Record<string, string>,
  ): Promise<AwardResult> => {
    const result = await awardPoints(type, metadata)
    if (!result.skipped && result.points > 0) {
      setData((prev) => {
        if (!prev) return prev
        const newEvent: PointEvent = {
          id: Math.random().toString(36).slice(2),
          type,
          points: result.points,
          label: labelForType(type),
          metadata: metadata ?? {},
          created_at: new Date().toISOString(),
        }
        return {
          current_points:      result.current_points,
          total_points_earned: result.total_points_earned,
          history: [newEvent, ...prev.history].slice(0, 20),
        }
      })
    }
    return result
  }, [])

  return { data, loading, refresh, award }
}
