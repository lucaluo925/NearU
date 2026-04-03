'use client'

/**
 * ThemeApplicator — zero-render client component.
 * Fetches the user's active theme from /api/themes and applies
 * `data-theme="<id>"` to the <html> element.
 * Must be rendered inside <body> so document is available.
 */
import { useTheme } from '@/hooks/useTheme'

export default function ThemeApplicator() {
  useTheme() // side-effect only: sets data-theme on document.documentElement
  return null
}
