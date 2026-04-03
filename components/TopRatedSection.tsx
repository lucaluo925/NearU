import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MapPin, Star } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { isTableMissing } from '@/lib/db-errors'

const SHOW_N = 8

const CAT_GRADIENT: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

function TopRatedCard({ item, avgRating }: { item: Item; avgRating: number }) {
  const cat      = CATEGORIES.find((c) => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group h-[260px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image — always 140px */}
      <div className={cn('relative h-[140px] w-full shrink-0 overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover group-hover:scale-[1.03] transition-transform duration-300" sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] font-medium text-amber-700 bg-white/90 border border-amber-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
            ⭐ Top Rated
          </span>
        </div>
      </div>
      {/* Body */}
      <div className="flex flex-col p-3 flex-1 overflow-hidden">
        <h3 className="text-[13px] font-bold text-[#111111] leading-snug line-clamp-2 h-[40px] group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>
        <div className="mt-auto">
          <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] overflow-hidden">
            {loc && <MapPin className="w-2.5 h-2.5 shrink-0" />}
            <span className="truncate">{loc}</span>
          </p>
          <div className="flex items-center gap-1 text-[10px] font-medium text-amber-600 mt-0.5">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            <span>{avgRating.toFixed(1)}</span>
            <span className="text-[#C4C9D4] capitalize ml-0.5">{item.category}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

async function getTopRatedFood(): Promise<(Item & { avg_rating: number; review_count: number })[]> {
  const supabase = getServerSupabase()
  const { data: items } = await supabase
    .from('items')
    .select('*')
    .in('category', ['food'])
    .eq('status', 'approved')
    .is('deleted_at', null)
    .limit(100)
  if (!items || items.length === 0) return []
  const ids = items.map((i) => i.id)
  let ratingMap: Record<string, { avg_rating: number; review_count: number }> = {}
  try {
    const { data: reviews, error } = await supabase.from('reviews').select('item_id, rating').in('item_id', ids)
    if (!error && reviews && reviews.length > 0) {
      const sums: Record<string, number> = {}
      const counts: Record<string, number> = {}
      for (const r of reviews) {
        sums[r.item_id]   = (sums[r.item_id]   ?? 0) + (r.rating as number)
        counts[r.item_id] = (counts[r.item_id] ?? 0) + 1
      }
      for (const id of Object.keys(counts)) {
        ratingMap[id] = { avg_rating: Math.round((sums[id] / counts[id]) * 10) / 10, review_count: counts[id] }
      }
    }
  } catch (e: unknown) {
    if (!isTableMissing(e as { code?: string; message?: string })) console.error('[TopRatedSection]', e)
  }
  return items
    .filter((i) => ratingMap[i.id])
    .map((i) => ({ ...i, ...ratingMap[i.id] }))
    .sort((a, b) => b.avg_rating !== a.avg_rating ? b.avg_rating - a.avg_rating : b.review_count - a.review_count)
    .slice(0, SHOW_N) as (Item & { avg_rating: number; review_count: number })[]
}

export default async function TopRatedSection() {
  let items: (Item & { avg_rating: number; review_count: number })[] = []
  try { items = await getTopRatedFood() } catch { return null }
  if (items.length === 0) return null

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
          <h2 className="text-[15px] font-bold text-[#111111]">Top Rated Food</h2>
        </div>
        <Link href="/food" className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors group">
          See all <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <TopRatedCard key={item.id} item={item} avgRating={item.avg_rating} />
        ))}
      </div>
    </section>
  )
}
