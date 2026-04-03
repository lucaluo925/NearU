'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// Lazy-load the full modal so it doesn't bloat the initial bundle
const FeedbackModal = dynamic(() => import('./FeedbackModal'), { ssr: false })

export default function FeedbackCue() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[13px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors underline underline-offset-2"
      >
        Found an issue? Send feedback
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
