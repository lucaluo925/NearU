import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MapPin, Clock, TrendingUp } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { formatTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import TrendingClickReporter from '@/components/TrendingClickReporter'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const SHOW_N = 8

const CAT_GRADIENT: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  shopping: 'from-purple-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  events:   'from-rose-100 to-pink-50',
}

// ── Card ──────────────────────────────────────────────────────────────────────

function DiscoveryCard({ item }: { item: Item }) {
  const cat      = CATEGORIES.find((c) => c.slug === item.category)
  const gradient = CAT_GRADIENT[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const time     = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? ''

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group h-[260px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image — always 140px */}
      <div className={cn('relative h-[140px] w-full shrink-0 overflow-hidden bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] font-medium text-orange-700 bg-white/90 border border-orange-200 rounded-full px-1.5 py-0.5 uppercase tracking-wide">
            🔥 Trending
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
          <div className="flex items-center gap-1 text-[10px] font-medium text-[#6B7280] mt-0.5">
            {time ? (
              <>
                <Clock className="w-2.5 h-2.5 shrink-0 text-[#9CA3AF]" />
                <span>{time}</span>
              </>
            ) : (
              <span className="text-[#C4C9D4] capitalize">{item.category}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function getTopIds(type: 'view' | 'favorite', since: string): Promise<string[]> {
  const supabase = getServerSupabase()
  const { data, error } = await supabase
    .from('interaction_logs')
    .select('item_id')
    .eq('type', type)
    .gte('created_at', since)
  if (error || !data) return []
  const counts = new Map<string, number>()
  for (const { item_id } of data) counts.set(item_id, (counts.get(item_id) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, SHOW_N).map(([id]) => id)
}

async function fetchItems(ids: string[]): Promise<Item[]> {
  if (ids.length === 0) return []
  const supabase = getServerSupabase()
  const { data } = await supabase
    .from('items')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
    .eq('status', 'approved')
  if (!data) return []
  const map = new Map(data.map((i) => [i.id, i]))
  return ids.map((id) => map.get(id)).filter(Boolean) as Item[]
}

async function getFallbackItems(): Promise<Item[]> {
  const supabase = getServerSupabase()
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(SHOW_N)
  return (data ?? []) as Item[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default async function PopularSections() {
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

  let trendingItems: Item[] = []

  try {
    const [trendingIds, popularIds] = await Promise.all([
      getTopIds('view', since),
      getTopIds('favorite', since),
    ])
    // Merge view + favorite IDs, deduplicate, preserve ranking signal
    const merged = [...new Set([...trendingIds, ...popularIds])].slice(0, SHOW_N)
    trendingItems = await fetchItems(merged)
  } catch {
    // interaction_logs table may not exist yet — fall through to fallback
  }

  // Always-filled: fall back to recent approved items
  if (trendingItems.length < 3) {
    try {
      const fallback = await getFallbackItems()
      // Merge and deduplicate
      const existing = new Set(trendingItems.map((i) => i.id))
      trendingItems = [
        ...trendingItems,
        ...fallback.filter((i) => !existing.has(i.id)),
      ].slice(0, SHOW_N)
    } catch {
      // ignore
    }
  }

  if (trendingItems.length === 0) return null

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-orange-500" />
          <h2 className="text-[15px] font-bold text-[#111111]">Trending Now</h2>
        </div>
        <Link
          href="/search"
          className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors group"
        >
          See all
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {trendingItems.map((item) => (
          <TrendingClickReporter key={item.id}>
            <DiscoveryCard item={item} />
          </TrendingClickReporter>
        ))}
      </div>
    </section>
  )
}
