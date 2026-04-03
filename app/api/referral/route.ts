import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-helper'

// ── GET /api/referral — return the user's referral share URL ─────────────────
//
// The referral code is simply the user's UUID.
// Share URL format: https://davis-explorer.vercel.app/?ref=USER_ID

const BASE_URL = 'https://davis-explorer.vercel.app'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shareUrl = `${BASE_URL}/?ref=${user.id}`
  return NextResponse.json({ ref_code: user.id, share_url: shareUrl })
}
