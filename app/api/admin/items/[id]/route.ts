import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'
import { ItemStatus } from '@/lib/types'

const ALLOWED_STATUSES: ItemStatus[] = ['approved', 'rejected', 'flagged', 'pending']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = getServerSupabase()
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { status, review_notes } = body

  if (status !== undefined && !ALLOWED_STATUSES.includes(status as ItemStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  // Build update payload
  const update: Record<string, unknown> = {}
  if (status !== undefined) {
    update.status = status
    update.reviewed_at = new Date().toISOString()
    update.reviewed_by = 'admin'
  }
  if (review_notes !== undefined) {
    update.review_notes = review_notes ? String(review_notes).trim() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('items')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: error ? 500 : 404 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = getServerSupabase()
  const { id } = await params

  const { error } = await supabase
    .from('items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
