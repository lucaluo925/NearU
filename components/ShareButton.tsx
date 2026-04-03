'use client'

import { useState, useEffect } from 'react'
import { Share2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { awardPoints } from '@/hooks/usePoints'
import { awardPetXP } from '@/hooks/usePet'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const BASE_URL = 'https://davis-explorer.vercel.app'

interface Props {
  /** When provided, shares a specific event page and awards share_event pts */
  itemId?: string
  className?: string
}

/**
 * ShareButton — native share API with clipboard fallback.
 *
 * • Homepage: generates BASE_URL/?ref=USER_ID, awards share_homepage (+10, one-time)
 * • Event page: generates BASE_URL/listing/ITEM_ID?ref=USER_ID, awards share_event (+5, rate-limited)
 * • Points awarded only for logged-in users; non-logged-in users just share normally.
 */
export default function ShareButton({ itemId, className }: Props) {
  const { show } = useToast()
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  async function handleShare() {
    const ref  = userId ? `?ref=${userId}` : ''
    const url  = itemId
      ? `${BASE_URL}/listing/${itemId}${ref}`
      : `${BASE_URL}/${ref}`
    const title = itemId
      ? undefined
      : 'NearU — Your campus, your corner'

    let shared = false

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url })
        shared = true
      } catch {
        // cancelled — fall through to clipboard
      }
    }

    if (!shared) {
      try {
        await navigator.clipboard.writeText(url)
        show('Link copied')
        shared = true
      } catch {
        show('Could not copy link', 'error')
        return
      }
    }

    // Award points + pet XP to logged-in users
    if (shared && userId) {
      const type     = itemId ? 'share_event' : 'share_homepage'
      const metadata = itemId ? { item_id: itemId } : undefined
      const [ptResult, petResult] = await Promise.all([
        awardPoints(type, metadata),
        awardPetXP('share'),
      ])
      if (!ptResult.skipped && ptResult.points > 0) {
        show(`+${ptResult.points} pts — Shared 🎉`)
      }
      window.dispatchEvent(
        new CustomEvent('pet:react', {
          detail: {
            type:   (petResult as { level_up?: boolean } | null)?.level_up ? 'celebrate' : 'excited',
            action: 'share',
            bond:   2,
          },
        }),
      )
    }
  }

  return (
    <button
      onClick={handleShare}
      title={itemId ? 'Share this event' : 'Share NearU'}
      className={
        className ??
        'flex items-center gap-1.5 text-[13px] font-medium text-[#6B7280] border border-[#E5E7EB] bg-white rounded-xl px-3 py-2.5 hover:bg-[#F9FAFB] hover:border-[#D1D5DB] transition-all shadow-sm shrink-0'
      }
    >
      <Share2 className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Share</span>
    </button>
  )
}
