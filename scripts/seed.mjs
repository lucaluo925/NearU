import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Load credentials from .env.local
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
)

const supabase = createClient(
  env['NEXT_PUBLIC_SUPABASE_URL'],
  env['SUPABASE_SERVICE_ROLE_KEY'] ?? env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
)

const now = new Date()
const d = (days, hour = 12) => {
  const dt = new Date(now)
  dt.setDate(dt.getDate() + days)
  dt.setHours(hour, 0, 0, 0)
  return dt.toISOString()
}

const items = [
  // ── EVENTS ──────────────────────────────────────────────────────────────
  {
    title: 'Spring Career Fair 2026',
    category: 'events', subcategory: 'career-networking',
    location_name: 'UC Davis ARC Ballroom',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(15, 10), end_time: d(15, 15),
    external_link: 'https://icc.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor', 'networking'],
  },
  {
    title: 'Davis Art Collective: Spring Open Mic',
    category: 'events', subcategory: 'arts-music',
    location_name: 'The Varsity Theatre',
    address: '616 2nd St, Davis, CA 95616',
    start_time: d(11, 20), end_time: d(11, 22),
    external_link: 'https://thevarsitytheatre.com',
    tags: ['paid', 'indoor', 'music'],
  },
  {
    title: 'Davis Symphony Orchestra Spring Concert',
    category: 'events', subcategory: 'arts-music',
    location_name: 'Mondavi Center',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(18, 19), end_time: d(18, 21),
    external_link: 'https://mondaviarts.org',
    tags: ['paid', 'indoor', 'music'],
  },
  {
    title: 'Davis Community Garden Volunteer Day',
    category: 'events', subcategory: 'volunteer',
    location_name: 'South Davis Community Garden',
    address: '2600 Lake Blvd, Davis, CA 95616',
    start_time: d(12, 9), end_time: d(12, 12),
    external_link: 'https://cityofdavis.org',
    tags: ['free', 'outdoor', 'beginner-friendly'],
  },
  {
    title: 'ASUCD Senate Candidate Forum',
    category: 'events', subcategory: 'academic-lecture',
    location_name: 'Memorial Union — Freeborn Hall',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(6, 18), end_time: d(6, 20),
    external_link: 'https://asucd.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor', 'academic'],
  },
  {
    title: 'Startup Pitch Night — Davis Entrepreneurship Club',
    category: 'events', subcategory: 'career-networking',
    location_name: 'Kemper Hall 1065',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(8, 18), end_time: d(8, 20),
    external_link: 'https://startupucd.org',
    tags: ['free', 'student-friendly', 'indoor', 'networking'],
  },
  {
    title: 'Latinx Heritage Night — MEChA',
    category: 'events', subcategory: 'social-party',
    location_name: 'Student Community Center',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(7, 19), end_time: d(7, 22),
    external_link: 'https://scc.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
  },

  // ── FOOD ────────────────────────────────────────────────────────────────
  {
    title: 'Tacos El Patron',
    category: 'food', subcategory: 'restaurant',
    location_name: 'Tacos El Patron',
    address: '130 G St, Davis, CA 95616',
    external_link: 'https://maps.app.goo.gl/tacoselpatron',
    tags: ['cheap-eats', 'student-friendly', 'food'],
    latitude: 38.5449, longitude: -121.7405,
  },
  {
    title: 'Burgers & Brew',
    category: 'food', subcategory: 'restaurant',
    location_name: 'Burgers & Brew',
    address: '403 3rd St, Davis, CA 95616',
    external_link: 'https://www.burgersbrew.com',
    tags: ['student-friendly', 'indoor', 'food'],
    latitude: 38.5448, longitude: -121.7398,
  },
  {
    title: 'Konditorei Coffee & Pastries',
    category: 'food', subcategory: 'cafe',
    location_name: 'Konditorei',
    address: '2710 Lillard Dr #105, Davis, CA 95618',
    external_link: 'https://www.konditoreidavis.com',
    tags: ['student-friendly', 'indoor'],
    latitude: 38.5501, longitude: -121.7254,
  },
  {
    title: 'Temple Coffee Roasters',
    category: 'food', subcategory: 'cafe',
    location_name: 'Temple Coffee Roasters',
    address: '239 G St, Davis, CA 95616',
    external_link: 'https://templecoffee.com',
    tags: ['student-friendly', 'indoor'],
    latitude: 38.5447, longitude: -121.7408,
  },
  {
    title: 'Scoop & Score Creamery',
    category: 'food', subcategory: 'dessert',
    location_name: 'Scoop & Score',
    address: '228 G St, Davis, CA 95616',
    external_link: 'https://www.icecreamdavis.com',
    tags: ['student-friendly', 'indoor', 'food'],
    latitude: 38.5447, longitude: -121.7406,
  },
  {
    title: 'Crepeville Davis',
    category: 'food', subcategory: 'cheap-eats',
    location_name: 'Crepeville',
    address: '330 3rd St, Davis, CA 95616',
    external_link: 'https://www.crepeville.com',
    tags: ['cheap-eats', 'student-friendly', 'indoor', 'food'],
    latitude: 38.5448, longitude: -121.7393,
  },
  {
    title: 'De Vere\'s Irish Pub',
    category: 'food', subcategory: 'restaurant',
    location_name: "De Vere's Irish Pub",
    address: '217 E St, Davis, CA 95616',
    external_link: 'https://deveresdavis.com',
    tags: ['indoor', 'food'],
    latitude: 38.5441, longitude: -121.7399,
  },

  // ── OUTDOOR ─────────────────────────────────────────────────────────────
  {
    title: 'Arboretum Waterway Trail',
    category: 'outdoor', subcategory: 'trails',
    location_name: 'UC Davis Arboretum',
    address: 'La Rue Rd, Davis, CA 95616',
    external_link: 'https://arboretum.ucdavis.edu',
    tags: ['free', 'outdoor', 'beginner-friendly'],
    latitude: 38.5318, longitude: -121.7493,
  },
  {
    title: 'Central Park Davis',
    category: 'outdoor', subcategory: 'parks',
    location_name: 'Central Park',
    address: '4th St & C St, Davis, CA 95616',
    external_link: 'https://cityofdavis.org/parks',
    tags: ['free', 'outdoor'],
    latitude: 38.5448, longitude: -121.7384,
  },
  {
    title: 'Putah Creek Riparian Reserve',
    category: 'outdoor', subcategory: 'scenic-spots',
    location_name: 'Putah Creek Reserve',
    address: 'Old Davis Rd, Davis, CA 95616',
    external_link: 'https://putahcreek.org',
    tags: ['free', 'outdoor', 'beginner-friendly'],
    latitude: 38.5277, longitude: -121.7785,
  },
  {
    title: 'Sudwerk Dock Store Beer Garden',
    category: 'outdoor', subcategory: 'scenic-spots',
    location_name: 'Sudwerk Brewing Co.',
    address: '2001 2nd St, Davis, CA 95618',
    external_link: 'https://sudwerkbrew.com',
    tags: ['outdoor', 'paid'],
    latitude: 38.5489, longitude: -121.7218,
  },

  // ── STUDY ────────────────────────────────────────────────────────────────
  {
    title: 'Shields Library — 24hr Reading Room',
    category: 'study', subcategory: 'library',
    location_name: 'Peter J. Shields Library',
    address: '100 NW Quad, Davis, CA 95616',
    external_link: 'https://library.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor', 'quiet'],
    latitude: 38.5397, longitude: -121.7491,
  },
  {
    title: 'Bainer Hall Study Lounge',
    category: 'study', subcategory: 'quiet-spaces',
    location_name: 'Bainer Hall',
    address: '1 Shields Ave, Davis, CA 95616',
    external_link: 'https://engineering.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
    latitude: 38.5358, longitude: -121.7510,
  },
  {
    title: 'Temple Coffee — Study-Friendly Cafe',
    category: 'study', subcategory: 'cafe-study-spots',
    location_name: 'Temple Coffee Roasters',
    address: '239 G St, Davis, CA 95616',
    external_link: 'https://templecoffee.com',
    tags: ['student-friendly', 'indoor', 'paid'],
    latitude: 38.5447, longitude: -121.7408,
  },
  {
    title: 'Scrub Hub — Group Study Rooms',
    category: 'study', subcategory: 'group-study',
    location_name: 'Student Health & Wellness Center',
    address: '1 Shields Ave, Davis, CA 95616',
    external_link: 'https://shcs.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
    latitude: 38.5413, longitude: -121.7520,
  },

  // ── SHOPPING ─────────────────────────────────────────────────────────────
  {
    title: 'Davis Farmers Market',
    category: 'shopping', subcategory: 'weekend-market',
    location_name: 'Central Park Pavilion',
    address: '4th St & C St, Davis, CA 95616',
    external_link: 'https://davisfarmersmarket.org',
    tags: ['outdoor', 'weekend', 'food', 'student-friendly'],
    latitude: 38.5448, longitude: -121.7384,
  },
  {
    title: 'Nugget Markets',
    category: 'shopping', subcategory: 'grocery',
    location_name: 'Nugget Markets Davis',
    address: '1414 E Covell Blvd, Davis, CA 95616',
    external_link: 'https://www.nuggetmarket.com',
    tags: ['indoor', 'student-friendly'],
    latitude: 38.5592, longitude: -121.7304,
  },
  {
    title: 'The Wardrobe — Vintage & Thrift',
    category: 'shopping', subcategory: 'fashion',
    location_name: 'The Wardrobe',
    address: '222 G St, Davis, CA 95616',
    external_link: 'https://www.wardrobedavis.com',
    tags: ['indoor', 'student-friendly'],
    latitude: 38.5447, longitude: -121.7406,
  },
  {
    title: 'Bike & Hike Davis',
    category: 'shopping', subcategory: 'local-shops',
    location_name: 'Bike & Hike',
    address: '610 3rd St, Davis, CA 95616',
    external_link: 'https://bikeandhikedavis.com',
    tags: ['indoor', 'student-friendly'],
    latitude: 38.5447, longitude: -121.7421,
  },

  // ── CAMPUS ───────────────────────────────────────────────────────────────
  {
    title: 'Student Health & Counseling Services',
    category: 'campus', subcategory: 'student-services',
    location_name: 'Student Health & Wellness Center',
    address: '1 Shields Ave, Davis, CA 95616',
    external_link: 'https://shcs.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
    latitude: 38.5413, longitude: -121.7520,
  },
  {
    title: 'ASUCD Coffee House',
    category: 'campus', subcategory: 'student-services',
    location_name: 'The Coffee House (CoHo)',
    address: 'Memorial Union, Davis, CA 95616',
    external_link: 'https://coffeehouse.ucdavis.edu',
    tags: ['student-friendly', 'indoor', 'food'],
    latitude: 38.5421, longitude: -121.7488,
  },
  {
    title: 'LGBTQIA Resource Center',
    category: 'campus', subcategory: 'resource-centers',
    location_name: 'LGBTQIA Resource Center',
    address: '1 Shields Ave, Davis, CA 95616',
    external_link: 'https://lgbtqia.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
    latitude: 38.5421, longitude: -121.7480,
  },
  {
    title: 'Transfer & Reentry Center',
    category: 'campus', subcategory: 'resource-centers',
    location_name: 'South Hall',
    address: '1 Shields Ave, Davis, CA 95616',
    external_link: 'https://trc.ucdavis.edu',
    tags: ['free', 'student-friendly', 'indoor'],
    latitude: 38.5430, longitude: -121.7488,
  },
  {
    title: 'Picnic Day 2026 — Campus Open House',
    category: 'campus', subcategory: 'campus-events',
    location_name: 'UC Davis Main Campus',
    address: '1 Shields Ave, Davis, CA 95616',
    start_time: d(20, 9), end_time: d(20, 17),
    external_link: 'https://picnicday.ucdavis.edu',
    tags: ['free', 'outdoor', 'student-friendly', 'beginner-friendly'],
    latitude: 38.5382, longitude: -121.7617,
  },
]

const BATCH = 10
let inserted = 0, failed = 0

for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH).map(item => ({
    ...item,
    source: 'seed',
  }))
  const { data, error } = await supabase.from('items').insert(batch).select('title')
  if (error) {
    console.error('Batch error:', error.message)
    failed += batch.length
  } else {
    data.forEach(r => console.log('✓', r.title))
    inserted += data.length
  }
}

console.log(`\nDone: ${inserted} inserted, ${failed} failed`)
