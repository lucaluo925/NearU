'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useToast } from '@/components/Toast'

const MESSAGES: Record<string, string> = {
  unauthorized: 'You are not authorized to access that page.',
}

/**
 * Reads the ?notice= query param, shows a toast, then cleans the URL.
 * Mount this anywhere inside a Suspense boundary.
 */
export default function NoticeToast() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { show } = useToast()

  useEffect(() => {
    const notice = searchParams.get('notice')
    if (!notice) return

    const message = MESSAGES[notice] ?? 'Something went wrong.'
    show(message, 'error')

    // Remove the ?notice param from the URL without a navigation
    const params = new URLSearchParams(searchParams.toString())
    params.delete('notice')
    const clean = params.size > 0 ? `${pathname}?${params}` : pathname
    router.replace(clean, { scroll: false })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
