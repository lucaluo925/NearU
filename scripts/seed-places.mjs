/**
 * Seed static place data directly into Supabase.
 * Run: node scripts/seed-places.mjs
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = new URL('../.env.local', import.meta.url).pathname
  if (!existsSync(envPath)) {
    console.error('.env.local not found')
    process.exit(1)
  }
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Load data files ───────────────────────────────────────────────────────────
function loadJson(name) {
  const p = new URL(`../data/places/${name}.json`, import.meta.url).pathname
  return JSON.parse(readFileSync(p, 'utf8'))
}

const ALL_PLACES = [
  ...loadJson('restaurants'),
  ...loadJson('cafes'),
  ...loadJson('study'),
  ...loadJson('outdoor'),
  ...loadJson('shopping'),
  ...loadJson('campus'),
]

console.log(`Loaded ${ALL_PLACES.length} places total`)

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeExternalId(place) {
  return `seed-${place.category}-${place.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)}`
}

function buildItem(place) {
  // Generate a Google Maps link so the constraint requires_link_or_flyer is satisfied
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
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
let inserted = 0, skipped = 0, failed = 0

for (const place of ALL_PLACES) {
  const item = buildItem(place)

  // Check for existing entry
  const { data: existing } = await supabase
    .from('items')
    .select('id')
    .eq('external_id', item.external_id)
    .maybeSingle()

  if (existing) {
    skipped++
    process.stdout.write('.')
    continue
  }

  const { error } = await supabase.from('items').insert(item)
  if (error) {
    if (error.code === '23505') {
      skipped++
      process.stdout.write('.')
    } else {
      failed++
      console.error(`\n✗ ${item.title}: ${error.message}`)
    }
  } else {
    inserted++
    process.stdout.write('+')
  }
}

console.log(`\n\nDone. inserted=${inserted} skipped=${skipped} failed=${failed}`)
