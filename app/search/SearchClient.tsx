'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { track } from '@vercel/analytics'
import SearchBar from '@/components/SearchBar'
import QuickFilters from '@/components/QuickFilters'
import ItemCard from '@/components/ItemCard'
import ItemListControls from '@/components/ItemListControls'
import RadiusSelector from '@/components/RadiusSelector'
import EmptyState from '@/components/EmptyState'
import { SkeletonItemCard } from '@/components/SkeletonCard'
import { ItemWithDistance, ViewMode, SortMode, RadiusMiles, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { CUISINE_FILTER_CHIPS, VIBE_FILTER_CHIPS, PRICE_FILTER_CHIPS } from '@/lib/tags'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

const TAG_QUICK_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'Free', value: 'free' },
  { label: 'Outdoor', value: 'outdoor' },
  { label: 'Student-Friendly', value: 'student-friendly' },
]

// ── Tag filter chip strip ─────────────────────────────────────────────────────

function FilterChipStrip({
  chips,
  activeFilters,
  onToggle,
}: {
  chips: { tag: string; label: string }[]
  activeFilters: string[]
  onToggle: (val: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(({ tag, label }) => {
        const active = activeFilters.includes(tag)
        return (
          <button
            key={tag}
            onClick={() => onToggle(tag)}
            className={cn(
              'text-[12px] font-medium rounded-full px-3 py-1 border transition-all',
              active
                ? 'bg-[#111111] text-white border-[#111111]'
                : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Collapsible filter section ────────────────────────────────────────────────

function TagFilterPanel({
  activeFilters,
  onToggle,
}: {
  activeFilters: string[]
  onToggle: (val: string) => void
}) {
  const [open, setOpen] = useState(false)
  const tagFilters = activeFilters.filter((f) => !['today', 'this-week'].includes(f))
  const hasTagFilters = tagFilters.length > 0

  return (
    <div className="border border-[#E5E7EB] rounded-2xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#374151]">Filter by tags</span>
          {hasTagFilters && (
            <span className="text-[11px] font-bold bg-[#111111] text-white rounded-full w-5 h-5 flex items-center justify-center">
              {tagFilters.length}
            </span>
          )}
        </div>
        <span className={cn('text-[#9CA3AF] text-[18px] leading-none transition-transform duration-200', open && 'rotate-45')}>+</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-[#F3F4F6]">
          <div className="pt-3">
            <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-2">Cuisine</p>
            <FilterChipStrip chips={CUISINE_FILTER_CHIPS} activeFilters={activeFilters} onToggle={onToggle} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-2">Vibe</p>
            <FilterChipStrip chips={VIBE_FILTER_CHIPS} activeFilters={activeFilters} onToggle={onToggle} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-2">Price</p>
            <FilterChipStrip chips={PRICE_FILTER_CHIPS} activeFilters={activeFilters} onToggle={onToggle} />
          </div>
          {hasTagFilters && (
            <button
              onClick={() => tagFilters.forEach(onToggle)}
              className="text-[12px] text-[#9CA3AF] hover:text-red-500 transition-colors text-left"
            >
              Clear all tag filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function SearchClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── State: always initialize to static defaults for SSR/client parity ──────
  // URL-dependent state is synced from searchParams in useEffect (client-only).
  // This prevents React hydration mismatches caused by server vs. client
  // searchParams diverging on statically-generated or server-rendered pages.
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [lastListView, setLastListView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<SortMode>('upcoming')
  const [radius, setRadius] = useState<RadiusMiles | null>(null)
  const [items, setItems] = useState<ItemWithDistance[]>([])
  const [loading, setLoading] = useState(false)

  // ── Sync URL → state once after mount (client-only) ─────────────────────────
  const [urlSynced, setUrlSynced] = useState(false)

  useEffect(() => {
    const q  = searchParams.get('q') ?? ''
    const tags = searchParams.getAll('tag')
    const time = searchParams.get('time')
    const cat  = searchParams.get('category') ?? ''
    const df   = searchParams.get('dateFrom') ?? ''
    const dt   = searchParams.get('dateTo')   ?? ''
    const v    = (searchParams.get('view') as ViewMode) ?? 'grid'
    const s    = (searchParams.get('sort') as SortMode) ?? 'upcoming'
    const r    = searchParams.get('radius')

    setSearch(q)
    setActiveFilters([...tags, ...(time ? [time] : [])])
    setSelectedCategory(cat)
    setDateFrom(df)
    setDateTo(dt)
    setView(v)
    setLastListView(v === 'list' ? 'list' : 'grid')
    setSort(s)
    setRadius(r ? (parseInt(r) as RadiusMiles) : null)
    setUrlSynced(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — run once on mount to read URL

  const syncUrl = useCallback(
    (q: string, filters: string[], cat: string, v: ViewMode, s: SortMode, r: RadiusMiles | null, df = dateFrom, dt = dateTo) => {
      const params = new URLSearchParams()
      if (q)   params.set('q', q)
      if (cat) params.set('category', cat)
      const tagFilters = filters.filter((f) => !['today', 'this-week'].includes(f))
      const timeFilter = filters.find((f) =>  ['today', 'this-week'].includes(f))
      tagFilters.forEach((t) => params.append('tag', t))
      if (timeFilter) params.set('time', timeFilter)
      if (!timeFilter && df) params.set('dateFrom', df)
      if (!timeFilter && dt) params.set('dateTo',   dt)
      if (v !== 'grid')     params.set('view', v)
      if (s !== 'upcoming') params.set('sort', s)
      if (r !== null)       params.set('radius', String(r))
      const qs = params.toString()
      router.replace(`/search${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [router, dateFrom, dateTo]
  )

  const fetchItems = useCallback(async () => {
    if (!search && activeFilters.length === 0 && !selectedCategory && !dateFrom) {
      setItems([]); setLoading(false); return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ sort })
      if (search)           params.set('search', search)
      if (selectedCategory) params.set('category', selectedCategory)
      const tagFilters = activeFilters.filter((f) => !['today', 'this-week'].includes(f))
      const timeFilter = activeFilters.find((f) =>  ['today', 'this-week'].includes(f))
      tagFilters.forEach((t) => params.append('tag', t))
      if (timeFilter) params.set('time', timeFilter)
      // Date range — only when no time preset active
      if (!timeFilter && dateFrom && dateTo) {
        params.set('dateFrom', dateFrom)
        params.set('dateTo',   dateTo)
      }
      if (radius !== null) {
        params.set('lat',    String(UC_DAVIS_LAT))
        params.set('lng',    String(UC_DAVIS_LNG))
        params.set('radius', String(radius))
      }
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) setItems(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [search, activeFilters, selectedCategory, dateFrom, dateTo, sort, radius])

  // Only fetch after URL has been synced to avoid double-fetching with wrong params
  useEffect(() => {
    if (urlSynced) fetchItems()
  }, [fetchItems, urlSynced])

  // Track search queries (debounced — fires 1s after user stops typing, min 3 chars)
  useEffect(() => {
    if (!urlSynced || search.length < 3) return
    const t = setTimeout(() => track('search', { query: search }), 1000)
    return () => clearTimeout(t)
  }, [search, urlSynced])

  const hasQuery = search || activeFilters.length > 0 || selectedCategory || dateFrom

  return (
    <div className="flex flex-col gap-6">
      {/* Search bar */}
      <div className="animate-fade-up animate-fade-up-delay-1">
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); syncUrl(v, activeFilters, selectedCategory, view, sort, radius) }}
          placeholder="Search events, places, food..."
        />
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 animate-fade-up animate-fade-up-delay-2">
        <button
          onClick={() => { setSelectedCategory(''); syncUrl(search, activeFilters, '', view, sort, radius) }}
          className={cn(
            'text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all',
            !selectedCategory ? 'bg-[#111111] text-white border-[#111111]' : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB]'
          )}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => { setSelectedCategory(cat.slug); syncUrl(search, activeFilters, cat.slug, view, sort, radius) }}
            className={cn(
              'text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all gap-1.5 inline-flex items-center',
              selectedCategory === cat.slug ? 'bg-[#111111] text-white border-[#111111]' : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB]'
            )}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Quick filters */}
      <div className="animate-fade-up animate-fade-up-delay-3">
        <QuickFilters
          activeFilters={activeFilters}
          onToggle={(val) => {
            let next: string[]
            if (['today', 'this-week'].includes(val)) {
              const without = activeFilters.filter((f) => !['today', 'this-week'].includes(f))
              next = activeFilters.includes(val) ? without : [...without, val]
            } else {
              next = activeFilters.includes(val) ? activeFilters.filter((f) => f !== val) : [...activeFilters, val]
            }
            setActiveFilters(next); syncUrl(search, next, selectedCategory, view, sort, radius)
          }}
          filters={TAG_QUICK_FILTERS}
        />
      </div>

      {/* Radius */}
      <div className="animate-fade-up animate-fade-up-delay-3">
        <RadiusSelector
          value={radius}
          onChange={(r) => { setRadius(r); syncUrl(search, activeFilters, selectedCategory, view, sort, r) }}
        />
      </div>

      {/* Tag filters (cuisine / vibe / price) */}
      <div className="animate-fade-up animate-fade-up-delay-3">
        <TagFilterPanel
          activeFilters={activeFilters}
          onToggle={(val) => {
            const next = activeFilters.includes(val)
              ? activeFilters.filter((f) => f !== val)
              : [...activeFilters, val]
            setActiveFilters(next)
            syncUrl(search, next, selectedCategory, view, sort, radius)
          }}
        />
      </div>

      {!hasQuery ? (
        <div className="mt-8">
          <p className="text-[14px] text-[#9CA3AF] text-center">Enter a search term or apply a filter to browse listings.</p>
          <div className="mt-10">
            <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4">Browse Categories</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat.slug}
                  href={`/${cat.slug}`}
                  className="flex items-center gap-2.5 bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3.5 hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <span className="text-xl">{cat.icon}</span>
                  <span className="text-[14px] font-medium text-[#111111]">{cat.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <ItemListControls
            view={view}
            onViewChange={(v) => {
              setView(v)
              if (v !== 'map') setLastListView(v as 'grid' | 'list')
              syncUrl(search, activeFilters, selectedCategory, v, sort, radius)
            }}
            sort={sort}
            onSortChange={(s) => { setSort(s); syncUrl(search, activeFilters, selectedCategory, view, s, radius) }}
            count={loading ? 0 : items.length}
            lastListView={lastListView}
          />

          {view === 'map' ? (
            <MapView items={items} />
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonItemCard key={i} />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="No results found" description="Try different keywords or adjust your filters." />
          ) : (
            <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'flex flex-col gap-3'}>
              {items.map((item) => <ItemCard key={item.id} item={item} view={view} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
