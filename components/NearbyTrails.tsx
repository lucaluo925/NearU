/**
 * NearbyTrails — server component
 * Shows nearby outdoor items on outdoor detail pages.
 */
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Navigation } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'
import { haversineDistance, formatDistance } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { parseTrailMeta, difficultyColor } from '@/lib/trail-utils'

const OUTDOOR_GRADIENT = 'from-emerald-100 to-teal-50'

/** Numeric rank for trail difficulty — used for similarity scoring */
const DIFF_RANK: Record<string, number> = {
  Easy: 1, Moderate: 2, Hard: 3, Strenuous: 4,
}

function tagOverlapCount(a: string[], b: string[]): number {
  const setA = new Set(a.map((t) => t.toLowerCase()))
  return b.filter((t) => setA.has(t.toLowerCase())).length
}

async function fetchNearby(
  currentId: string,
  lat: number,
  lng: number,
  subcategory: string,
  difficulty?: string,
  tags: string[] = [],
): Promise<Array<Item & { distance_miles: number }>> {
  const supabase = getServerSupabase()

  // Fetch a broad set of outdoor items with coordinates
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('category', 'outdoor')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .neq('id', currentId)
    .limit(60)

  if (!data) return []

  const currentDiffRank = difficulty ? (DIFF_RANK[difficulty] ?? 2) : null

  // Score each item: lower = better
  // Components: distance (miles) + difficulty mismatch penalty - tag overlap bonus - subcategory bonus
  const scored = (data as Item[])
    .map((item) => {
      const dist = Math.round(haversineDistance(lat, lng, item.latitude!, item.longitude!) * 10) / 10
      const meta = parseTrailMeta(item.known_for)
      const itemDiffRank = meta.difficulty ? (DIFF_RANK[meta.difficulty] ?? 2) : null
      const diffPenalty  = currentDiffRank !== null && itemDiffRank !== null
        ? Math.abs(currentDiffRank - itemDiffRank) * 0.6
        : 0
      const tagBonus  = tagOverlapCount(tags, item.tags ?? []) * 0.4
      const subBonus  = item.subcategory === subcategory ? 2 : 0
      const score     = dist + diffPenalty - tagBonus - subBonus
      return { ...item, distance_miles: dist, _score: score }
    })
    .filter((item) => item.distance_miles <= 20)
    .sort((a, b) => a._score - b._score)

  // Strip internal score field before returning
  return scored.slice(0, 6).map(({ _score: _s, ...item }) => item)
}

function NearbyCard({ item }: { item: Item & { distance_miles: number } }) {
  const meta = parseTrailMeta(item.known_for)
  return (
    <Link
      href={`/listing/${item.id}`}
      className="group flex-none w-[180px] sm:w-[200px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image zone */}
      <div className={cn('relative h-[100px] shrink-0 bg-gradient-to-br', OUTDOOR_GRADIENT)}>
        {item.flyer_image_url ? (
          <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover group-hover:scale-[1.03] transition-transform duration-300" sizes="200px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">🌿</span>
          </div>
        )}
        {/* Difficulty badge on image */}
        {meta.difficulty && (
          <span className={cn('absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full border', difficultyColor(meta.difficulty))}>
            {meta.difficulty}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1 p-3 flex-1">
        <h3 className="text-[12px] font-semibold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors" style={{ minHeight: '2.4em' }}>
          {item.title}
        </h3>
        <div className="flex items-center gap-2 mt-auto pt-1">
          {meta.length && (
            <span className="text-[10px] text-[#6B7280] whitespace-nowrap">{meta.length}</span>
          )}
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 ml-auto whitespace-nowrap">
            <Navigation className="w-2.5 h-2.5" />
            {formatDistance(item.distance_miles)}
          </span>
        </div>
      </div>
    </Link>
  )
}

interface Props {
  currentId:   string
  latitude:    number
  longitude:   number
  subcategory: string
  difficulty?: string
  tags?:       string[]
}

export default async function NearbyTrails({ currentId, latitude, longitude, subcategory, difficulty, tags }: Props) {
  let items: Array<Item & { distance_miles: number }> = []
  try {
    items = await fetchNearby(currentId, latitude, longitude, subcategory, difficulty, tags)
  } catch {
    return null
  }
  if (items.length === 0) return null

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[13px] font-bold text-[#374151] uppercase tracking-wider">
          🗺 Nearby Outdoor Spots
        </h2>
        <Link href="/outdoor" className="flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors group">
          See all
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x snap-mandatory scrollbar-hide">
        {items.map((item) => (
          <div key={item.id} className="snap-start">
            <NearbyCard item={item} />
          </div>
        ))}
      </div>
    </section>
  )
}
