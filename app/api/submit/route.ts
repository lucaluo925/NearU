import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { moderateSubmission } from '@/lib/moderation'
import { createServerClient } from '@supabase/ssr'
import crypto from 'crypto'

const RATE_LIMIT = 5 // submissions per hour per IP

async function checkRateLimit(ipHash: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true
  const supabase = getServerSupabase()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('submission_log')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourAgo)

  if (error) return true // allow on error
  return (count ?? 0) < RATE_LIMIT
}

async function logSubmission(ipHash: string) {
  const supabase = getServerSupabase()
  await supabase.from('submission_log').insert({ ip_hash: ipHash })
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase()

  // Attempt to identify the logged-in user (non-blocking)
  let userId: string | null = null
  try {
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() { /* read-only in API route */ },
        },
      }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      userId = user.id
      // Update last_seen_at on profile (best-effort)
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {})
    }
  } catch { /* ignore auth errors */ }

  // Rate limiting
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex')

  const allowed = await checkRateLimit(ipHash)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many submissions. Please try again later.' },
      { status: 429 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validation
  const required = ['title', 'category', 'subcategory', 'address']
  for (const field of required) {
    if (!body[field] || String(body[field]).trim() === '') {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 })
    }
  }

  if (!body.external_link && !body.flyer_image_url) {
    return NextResponse.json(
      { error: 'Either an external link or flyer image is required' },
      { status: 400 }
    )
  }

  if (body.start_time && body.end_time) {
    if (new Date(body.end_time as string) < new Date(body.start_time as string)) {
      return NextResponse.json(
        { error: 'End time must be after start time' },
        { status: 400 }
      )
    }
  }

  // Title length
  if (String(body.title).length > 200) {
    return NextResponse.json({ error: 'Title is too long' }, { status: 400 })
  }

  // Check for duplicate (same title + start_time)
  if (body.start_time) {
    const { data: existing } = await supabase
      .from('items')
      .select('id')
      .ilike('title', String(body.title))
      .eq('start_time', body.start_time as string)
      .is('deleted_at', null)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'An item with this title and start time already exists' },
        { status: 409 }
      )
    }
  }

  const title       = String(body.title).trim()
  const category    = String(body.category)
  const subcategory = String(body.subcategory)
  const description = body.description ? String(body.description).trim() : null
  const address     = String(body.address).trim()

  // AI moderation — runs before insert, determines status
  const modResult = await moderateSubmission({
    title,
    description,
    category,
    subcategory,
    address: address,
    external_link: body.external_link ? String(body.external_link).trim() : null,
    tags: Array.isArray(body.tags) ? body.tags : [],
  })

  const status = modResult.auto_flag ? 'flagged' : 'pending'

  const item = {
    title,
    category,
    subcategory,
    description,
    location_name: body.location_name ? String(body.location_name).trim() : null,
    address,
    latitude: body.latitude ? Number(body.latitude) : null,
    longitude: body.longitude ? Number(body.longitude) : null,
    start_time: body.start_time || null,
    end_time: body.end_time || null,
    external_link: body.external_link ? String(body.external_link).trim() : null,
    flyer_image_url: body.flyer_image_url ? String(body.flyer_image_url).trim() : null,
    source: 'user',
    tags: Array.isArray(body.tags) ? body.tags : [],
    created_by: userId,
    status,
    risk_score: modResult.risk_score,
    moderation_reason: modResult.reason,
  }

  const { data, error } = await supabase.from('items').insert(item).select().single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'An item with this title and start time already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logSubmission(ipHash)

  return NextResponse.json(data, { status: 201 })
}
