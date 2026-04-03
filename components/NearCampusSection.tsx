import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MapPin, Navigation } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { haversineDistance, formatDistance } from '@/lib/utils'
import { CATEGORIES } from '@/lib/constants'
import { isTableMissing } from '@/lib/db-errors'
import { cn } from '@/lib/utils'

const RADIUS_MI = 5
const SHOW_N    = 8

const CAT_GRADIENT: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

type Enriched = Item & { avg_rating: number | null; review_count: number; distance_miles: number }

function NearbyCard({ item }: { item: Enriched }) {
  const cat      = CATEGORIES.find((c) => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group flex-none w-[200px] sm:w-[220px] h-[228px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      <div className={cn('relative h-[116px] shrink-0 bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover group-hover:scale-[1.03] transition-transform duration-300" sizes="220px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] font-medium text-emerald-700 bg-white/90 border border-emerald-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
            📍 {formatDistance(item.distance_miles)}
          </span>
        </div>
      </div>
      <div className="flex flex-col p-3 flex-1 overflow-hidden">
        <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors" style={{ minHeight: '2.5em' }}>
          {item.title}
        </h3>
        <div className="flex-1" />
        <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] h-[16px] overflow-hidden">
          {loc && <MapPin className="w-2.5 h-2.5 shrink-0" />}
          <span className="line-clamp-1">{loc}</span>
        </p>
        <div className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] h-[18px] mt-0.5">
          <Navigation className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
          <span>{formatDistance(item.distance_miles)} from campus</span>
        </div>
      </div>
    </Link>
  )
}

export default async function NearCampusSection() {
  const supabase = getServerSupabase()
  const { data: rawItems } = await supabase
    .from('items')
    .select('*')
    .in('category', ['food', 'study', 'campus', 'outdoor'])
    .eq('status', 'approved')
    .is('deleted_at', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(200)
  if (!rawItems || rawItems.length === 0) return null

  const withDist: Enriched[] = rawItems
    .map((item) => ({
      ...item,
      avg_rating: null,
      review_count: 0,
      distance_miles: Math.round(haversineDistance(UC_DAVIS_LAT, UC_DAVIS_LNG, item.latitude, item.longitude) * 10) / 10,
    }))
    .filter((i) => i.distance_miles <= RADIUS_MI) as Enriched[]
  if (withDist.length === 0) return null

  const ids = withDist.map((i) => i.id)
  try {
    const { data: reviews, error } = await supabase.from('reviews').select('item_id, rating').in('item_id', ids)
    if (!error && reviews && reviews.length > 0) {
      const sums: Record<string, number> = {}
      const counts: Record<string, number> = {}
      for (const r of reviews) {
        sums[r.item_id]   = (sums[r.item_id]   ?? 0) + (r.rating as number)
        counts[r.item_id] = (counts[r.item_id] ?? 0) + 1
      }
      for (const item of withDist) {
        if (counts[item.id]) {
          item.avg_rating   = Math.round((sums[item.id] / counts[item.id]) * 10) / 10
          item.review_count = counts[item.id]
        }
      }
    }
  } catch (e: unknown) {
    if (!isTableMissing(e as { code?: string; message?: string })) console.error('[NearCampusSection]', e)
  }

  const maxDist = Math.max(...withDist.map((i) => i.distance_miles), 1)
  const top = withDist
    .map((item) => ({
      item,
      score: 0.5 * (1 - item.distance_miles / maxDist) + 0.5 * ((item.avg_rating ?? 2.5) / 5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHOW_N)
    .map(({ item }) => item)

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Navigation className="w-4 h-4 text-emerald-500" />
          <h2 className="text-[15px] font-bold text-[#111111]">Near Campus</h2>
        </div>
        <Link href="/search?tag=near-campus" className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors group">
          See all <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x snap-mandatory scrollbar-hide">
        {top.map((item) => (
          <div key={item.id} className="snap-start">
            <NearbyCard item={item} />
          </div>
        ))}
      </div>
    </section>
  )
}
