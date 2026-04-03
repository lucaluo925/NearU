'use client'

/**
 * HeroPetLine
 *
 * Renders a single taste-aware pet line beneath the homepage search bar.
 * Client-only: reads useTasteProfile from localStorage.
 * Shows nothing until hydrated (avoids layout shift).
 */

import { useState, useEffect } from 'react'
import { useTasteProfile, tasteSummary, getDominantTaste } from '@/hooks/useTasteProfile'

const TASTE_MSGS: Record<string, string> = {
  food:     "you've been into food spots lately 🍜",
  outdoor:  "you keep drifting to outdoor places 🌿",
  events:   "you've been in an event mood lately 🎉",
  study:    "study spots are your thing lately 📚",
  shopping: "you've been into shopping lately 🛍️",
  campus:   "you're very into campus stuff 🎓",
}

const TIME_MSGS: Record<string, string> = {
  morning:   "morning — here's what's on today 🌅",
  afternoon: "something worth leaving the house for 🎯",
  evening:   "you might like these tonight 👀",
}

export default function HeroPetLine() {
  const { profile, hydrated } = useTasteProfile()
  const [msg, setMsg]         = useState<string | null>(null)

  useEffect(() => {
    if (!hydrated) return

    const summary  = tasteSummary(profile)
    const dominant = getDominantTaste(profile)

    if (summary) {
      setMsg(`you always end up around ${summary} 😌`)
      return
    }

    if (dominant && TASTE_MSGS[dominant]) {
      setMsg(TASTE_MSGS[dominant])
      return
    }

    const hour = new Date().getHours()
    if (hour < 12)      setMsg(TIME_MSGS.morning)
    else if (hour < 17) setMsg(TIME_MSGS.afternoon)
    else                setMsg(TIME_MSGS.evening)
  }, [hydrated, profile])

  if (!msg) return null

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[13px] select-none" aria-hidden>🐶</span>
      <p className="text-[12px] text-[#9CA3AF] italic">{msg}</p>
    </div>
  )
}
