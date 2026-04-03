/**
 * SimilarEvents — server component
 * Shows upcoming events from the same category, excluding the current item.
 */

import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Clock, MapPin } from 'lucide-react'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'
import { formatDate, formatTime } from '@/lib/utils'
import { CATEGORIES } from '@/lib/constants'
import { cn } from '@/lib/utils'

const CATEGORY_GRADIENTS: Record<string, string> = {
  food:     'from-orange-100 to-amber-50',
  outdoor:  'from-emerald-100 to-green-50',
  study:    'from-blue-100 to-indigo-50',
  events:   'from-rose-100 to-pink-50',
  campus:   'from-yellow-100 to-amber-50',
  shopping: 'from-purple-100 to-pink-50',
}

async function fetchSimilar(
  currentId: string,
  category: string,
  subcategory: string,
  tags: string[],
): Promise<Item[]> {
  const supabase = getServerSupabase()
  const now      = new Date().toISOString()

  // Try same subcategory first
  const { data: sameSub } = await supabase
    .from('items')
    .select('*')
    .eq('category', category)
    .eq('subcategory', subcategory)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .neq('id', currentId)
    .or(`end_time.is.null,end_time.gte.${now}`)
    .order('start_time', { ascending: true, nullsFirst: false })
    .limit(6)

  if (sameSub && sameSub.length >= 3) return sameSub as Item[]

  // Fall back to same category
  const { data: sameCat } = await supabase
    .from('items')
    .select('*')
    .eq('category', category)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .neq('id', currentId)
    .or(`end_time.is.null,end_time.gte.${now}`)
    .order('start_time', { ascending: true, nullsFirst: false })
    .limit(6)

  return (sameCat ?? []) as Item[]
}

// ── Mini card ─────────────────────────────────────────────────────────────────

function SimilarCard({ item }: { item: Item }) {
  const cat      = CATEGORIES.find((c) => c.slug === item.category)
  const gradient = CATEGORY_GRADIENTS[item.category] ?? 'from-[#F3F4F6] to-[#E9EAEC]'
  const dateStr  = item.start_time ? formatDate(item.start_time) : null
  const timeStr  = item.start_time ? formatTime(item.start_time) : null
  const loc      = item.location_name ?? item.city ?? null

  return (
    <Link
      href={`/listing/${item.id}`}
      className="group flex-none w-[200px] sm:w-[220px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
    >
      {/* Image */}
      <div className={cn('relative h-[100px] shrink-0 bg-gradient-to-br', gradient)}>
        {item.flyer_image_url ? (
          <Image
            src={item.flyer_image_url}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
            sizes="220px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl opacity-40 select-none">{cat?.icon ?? '📌'}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1 p-3 flex-1">
        <h3 className="text-[13px] font-semibold text-[#111111] leading-snug line-clamp-2 group-hover:text-[#333] transition-colors">
          {item.title}
        </h3>
        {(dateStr || timeStr) && (
          <p className="flex items-center gap-1 text-[11px] text-[#6B7280]">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            {dateStr}{timeStr && ` · ${timeStr}`}
          </p>
        )}
        {loc && (
          <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF] line-clamp-1">
            <MapPin className="w-2.5 h-2.5 shrink-0" />
            {loc}
          </p>
        )}
      </div>
    </Link>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

interface Props {
  currentId:   string
  category:    string
  subcategory: string
  tags:        string[]
}

export default async function SimilarEvents({ currentId, category, subcategory, tags }: Props) {
  let items: Item[] = []
  try {
    items = await fetchSimilar(currentId, category, subcategory, tags)
  } catch {
    return null
  }

  if (items.length === 0) return null

  const isEvents = category === 'events'
  const label    = isEvents ? 'Similar Events' : 'More Like This'

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[13px] font-bold text-[#374151] uppercase tracking-wider">
          {label}
        </h2>
        <Link
          href={`/${category}/${subcategory}`}
          className="flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors group"
        >
          See all
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x snap-mandatory scrollbar-hide">
        {items.map((item) => (
          <div key={item.id} className="snap-start">
            <SimilarCard item={item} />
          </div>
        ))}
      </div>
    </section>
  )
}
