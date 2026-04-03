'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThemeState {
  unlocked: string[]
  active: string
  current_points: number
}

// ── Apply theme to <html> element ─────────────────────────────────────────────

function applyTheme(themeId: string) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', themeId)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTheme() {
  const [state, setState] = useState<ThemeState | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/themes')
      if (r.ok) {
        const d: ThemeState = await r.json()
        setState(d)
        applyTheme(d.active)
      }
    } catch {}
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Apply on mount from state
  useEffect(() => {
    if (state?.active) applyTheme(state.active)
  }, [state?.active])

  const unlock = useCallback(async (themeId: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', theme_id: themeId }),
      })
      const d = await r.json()
      if (r.ok) { setState(d); return { ok: true } }
      return { ok: false, error: d.error ?? 'Failed to unlock' }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }, [])

  const select = useCallback(async (themeId: string): Promise<{ ok: boolean }> => {
    try {
      const r = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select', theme_id: themeId }),
      })
      if (r.ok) {
        const d: ThemeState = await r.json()
        setState(d)
        applyTheme(themeId)
        return { ok: true }
      }
    } catch {}
    return { ok: false }
  }, [])

  return { state, refresh, unlock, select }
}
