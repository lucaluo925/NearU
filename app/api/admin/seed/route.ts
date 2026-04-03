import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { getAdminUser } from '@/lib/admin-auth'

import restaurants from '@/data/places/restaurants.json'
import cafes       from '@/data/places/cafes.json'
import study       from '@/data/places/study.json'
import outdoor     from '@/data/places/outdoor.json'
import shopping    from '@/data/places/shopping.json'
import campus      from '@/data/places/campus.json'

/**
 * POST /api/admin/seed
 * Admin-only endpoint to seed static place data into the items table.
 * Idempotent — uses external_id to match existing records.
 * On re-run, patches enrichment fields (menu_link, known_for, description if blank, tags if empty).
 */

type PlaceRecord = {
  title: string
  category: string
  subcategory: string
  address: string
  latitude?: number
  longitude?: number
  description?: string
  tags?: string[]
  city?: string
  region?: string
  menu_link?: string
  known_for?: string[]
  external_link?: string
}

function makeExternalId(place: PlaceRecord): string {
  return `seed-${place.category}-${place.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)}`
}

function buildItem(place: PlaceRecord) {
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(place.address)}`
  return {
    title:         place.title.slice(0, 200),
    category:      place.category,
    subcategory:   place.subcategory,
    description:   place.description ?? null,
    address:       place.address,
    city:          place.city ?? 'Davis',
    region:        place.region ?? 'davis',
    latitude:      place.latitude ?? null,
    longitude:     place.longitude ?? null,
    tags:          place.tags ?? [],
    external_link: place.external_link ?? mapsUrl,
    source:        'seed-data',
    source_type:   'seed-data',
    external_id:   makeExternalId(place),
    status:        'approved',
    last_seen_at:  new Date().toISOString(),
    menu_link:     place.menu_link ?? null,
    known_for:     place.known_for ?? null,
  }
}

export async function POST(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = getServerSupabase()
  const allPlaces: PlaceRecord[] = [
    ...(restaurants as PlaceRecord[]),
    ...(cafes       as PlaceRecord[]),
    ...(study       as PlaceRecord[]),
    ...(outdoor     as PlaceRecord[]),
    ...(shopping    as PlaceRecord[]),
    ...(campus      as PlaceRecord[]),
  ]

  let inserted = 0
  let updated  = 0
  let skipped  = 0
  let failed   = 0
  const errors:   string[] = []
  const warnings: string[] = []

  for (const place of allPlaces) {
    const item = buildItem(place)
    try {
      // Fetch existing record — select enrichment fields so we can merge intelligently
      const { data: existing } = await supabase
        .from('items')
        .select('id, description, tags, menu_link, known_for')
        .eq('external_id', item.external_id)
        .maybeSingle()

      if (existing) {
        const patch: Record<string, unknown> = {}

        // menu_link — always overwrite with seed value when present (new enrichment field)
        if (item.menu_link) patch.menu_link = item.menu_link

        // known_for — always overwrite with seed value when present (refreshes trail data)
        if (item.known_for && item.known_for.length > 0) patch.known_for = item.known_for

        // external_link — always overwrite with seed value when present (allows AllTrails links etc.)
        if (item.external_link) patch.external_link = item.external_link

        // description — only fill in if currently blank (preserve any manual edits)
        const currentDesc = (existing as Record<string, unknown>).description
        if (!currentDesc && item.description) patch.description = item.description

        // tags — only fill in if currently empty (preserve any manual edits)
        const currentTags = (existing as Record<string, unknown>).tags
        const tagsEmpty = !currentTags || (Array.isArray(currentTags) && currentTags.length === 0)
        if (tagsEmpty && item.tags && item.tags.length > 0) patch.tags = item.tags

        if (Object.keys(patch).length === 0) {
          skipped++ // already up-to-date, nothing to patch
          continue
        }

        const { error: updateError } = await supabase
          .from('items')
          .update(patch)
          .eq('id', (existing as Record<string, unknown>).id)

        if (updateError) {
          // Column doesn't exist yet → migration 006 not applied
          if (
            updateError.message?.includes('column') ||
            updateError.message?.includes('schema cache') ||
            updateError.message?.includes('does not exist')
          ) {
            const msg = 'Columns menu_link / known_for missing — run migration 006 in Supabase SQL Editor'
            if (!warnings.includes(msg)) warnings.push(msg)
            skipped++
          } else {
            failed++
            errors.push(`${item.title}: ${updateError.message}`)
          }
        } else {
          updated++
        }
        continue
      }

      const { error } = await supabase.from('items').insert(item)
      if (error) {
        if (error.code === '23505') {
          skipped++
        } else {
          failed++
          errors.push(`${item.title}: ${error.message}`)
        }
      } else {
        inserted++
      }
    } catch (err) {
      failed++
      errors.push(`${item.title}: ${(err as Error).message}`)
    }
  }

  return NextResponse.json({
    total:    allPlaces.length,
    inserted,
    updated,
    skipped,
    failed,
    errors:   errors.slice(0, 10),
    warnings: warnings.slice(0, 5),
  })
}

export async function GET(request: NextRequest) {
  if (!await getAdminUser(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const allPlaces = [
    ...(restaurants as PlaceRecord[]),
    ...(cafes       as PlaceRecord[]),
    ...(study       as PlaceRecord[]),
    ...(outdoor     as PlaceRecord[]),
    ...(shopping    as PlaceRecord[]),
    ...(campus      as PlaceRecord[]),
  ]
  return NextResponse.json({
    message: 'POST to this endpoint to seed place data',
    total_places: allPlaces.length,
    breakdown: {
      restaurants: (restaurants as PlaceRecord[]).length,
      cafes:       (cafes       as PlaceRecord[]).length,
      study:       (study       as PlaceRecord[]).length,
      outdoor:     (outdoor     as PlaceRecord[]).length,
      shopping:    (shopping    as PlaceRecord[]).length,
      campus:      (campus      as PlaceRecord[]).length,
    },
  })
}
