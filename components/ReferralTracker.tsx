'use client'

/**
 * ReferralTracker — zero-render client component.
 *
 * On mount:
 *   1. If URL has ?ref=USER_ID, save it to localStorage.
 *   2. If the user is logged in AND localStorage has a ref code,
 *      call /api/referral/convert to attribute the signup.
 */
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const REF_KEY = 'nearu-ref'

export default function ReferralTracker() {
  const params = useSearchParams()

  useEffect(() => {
    // 1. Persist referral code from URL
    const ref = params.get('ref')
    if (ref) {
      try { localStorage.setItem(REF_KEY, ref) } catch {}
    }

    // 2. Convert referral if user is already logged in
    async function tryConvert() {
      let storedRef: string | null = null
      try { storedRef = localStorage.getItem(REF_KEY) } catch {}
      if (!storedRef) return

      const supabase = createBrowserSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Never self-attribute
      if (storedRef === user.id) {
        try { localStorage.removeItem(REF_KEY) } catch {}
        return
      }

      try {
        const r = await fetch('/api/referral/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref_code: storedRef }),
        })
        if (r.ok) {
          try { localStorage.removeItem(REF_KEY) } catch {}
        }
      } catch {}
    }

    tryConvert()
  }, [params])

  return null
}
