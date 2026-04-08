import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth-helper'
import { limiters, getRequestKey, rateLimitResponse } from '@/lib/rate-limit'
import crypto from 'crypto'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function POST(request: NextRequest) {
  // Require authentication to prevent anonymous storage abuse.
  const user = await getSessionUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 30 per user per hour (Storage write, medium cost)
  const rl = limiters.upload.check(getRequestKey(request, user.id))
  if (rl.limited) return rateLimitResponse(rl.resetIn)

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    const ext = file.type.split('/')[1]
    const filename = `${crypto.randomUUID()}.${ext}`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const supabase = getServerSupabase()
    const { error } = await supabase.storage
      .from('flyers')
      .upload(filename, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabase.storage.from('flyers').getPublicUrl(filename)
    return NextResponse.json({ url: data.publicUrl }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
