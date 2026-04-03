'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { X, CalendarRange, Globe } from 'lucide-react'
import SearchBar from '@/components/SearchBar'
import QuickFilters from '@/components/QuickFilters'
import ItemCard from '@/components/ItemCard'
import ItemListControls from '@/components/ItemListControls'
import RadiusSelector from '@/components/RadiusSelector'
import EmptyState, { NoEventsState, NoResultsState, NoListingsState } from '@/components/EmptyState'
import { SkeletonItemCard, SkeletonListCard } from '@/components/SkeletonCard'
import { ItemWithDistance, ViewMode, SortMode, RadiusMiles, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { detectLanguages } from '@/lib/language-detection'

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

interface Props {
  categorySlug: string
  subcategorySlug: string
  categoryLabel: string
  subcategoryLabel: string
}

const TAG_QUICK_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'Free', value: 'free' },
  { label: 'Outdoor', value: 'outdoor' },
  { label: 'Student-Friendly', value: 'student-friendly' },
]

const FILTER_LABELS: Record<string, string> = {
  'today': 'Today',
  'this-week': 'This Week',
  'free': 'Free',
  'outdoor': 'Outdoor',
  'student-friendly': 'Student-Friendly',
}

// ── Date range picker ─────────────────────────────────────────────────────────

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
  onClear: () => void
}

function DateRangePicker({ dateFrom, dateTo, onChange, onClear }: DateRangePickerProps) {
  const today = new Date().toISOString().slice(0, 10)
  const hasRange = dateFrom || dateTo

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white border border-[#E5E7EB] rounded-xl px-3 py-1.5">
        <CalendarRange className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
        <input
          type="date"
          value={dateFrom}
          min={today}
          onChange={(e) => onChange(e.target.value, dateTo)}
          className="text-[13px] text-[#374151] bg-transparent border-none outline-none cursor-pointer w-[120px]"
          aria-label="From date"
        />
        <span className="text-[12px] text-[#9CA3AF]">–</span>
        <input
          type="date"
          value={dateTo}
          min={dateFrom || today}
          onChange={(e) => onChange(dateFrom, e.target.value)}
          className="text-[13px] text-[#374151] bg-transparent border-none outline-none cursor-pointer w-[120px]"
          aria-label="To date"
        />
      </div>
      {hasRange && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
        >
          <X className="w-3 h-3" />
          Clear dates
        </button>
      )}
    </div>
  )
}

// ── Active filter chips ───────────────────────────────────────────────────────

interface ActiveChipsProps {
  filters: string[]
  dateFrom: string
  dateTo: string
  search: string
  onRemoveFilter: (val: string) => void
  onClearDates: () => void
  onClearAll: () => void
}

function ActiveChips({
  filters, dateFrom, dateTo, search, onRemoveFilter, onClearDates, onClearAll,
}: ActiveChipsProps) {
  const hasDateRange = dateFrom && dateTo
  const total = filters.length + (hasDateRange ? 1 : 0) + (search ? 1 : 0)
  if (total === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters.map((f) => (
        <button
          key={f}
          onClick={() => onRemoveFilter(f)}
          className="flex items-center gap-1.5 text-[12px] font-medium bg-[#111111] text-white rounded-full px-3 py-1 hover:bg-[#333] transition-colors"
        >
          {FILTER_LABELS[f] ?? f}
          <X className="w-3 h-3" />
        </button>
      ))}
      {hasDateRange && (
        <button
          onClick={onClearDates}
          className="flex items-center gap-1.5 text-[12px] font-medium bg-[#111111] text-white rounded-full px-3 py-1 hover:bg-[#333] transition-colors"
        >
          {dateFrom} – {dateTo}
          <X className="w-3 h-3" />
        </button>
      )}
      {total > 1 && (
        <button
          onClick={onClearAll}
          className={cn(
            'text-[12px] font-medium text-[#6B7280] underline underline-offset-2',
            'hover:text-[#374151] transition-colors',
          )}
        >
          Clear all
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ItemListClient({
  categorySlug,
  subcategorySlug,
  categoryLabel,
  subcategoryLabel,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ── State: always initialize to static defaults for SSR/client parity ──────
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [lastListView, setLastListView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<SortMode>('upcoming')
  const [radius, setRadius] = useState<RadiusMiles | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showLangFilter, setShowLangFilter] = useState(false)

  const [urlSynced, setUrlSynced] = useState(false)
  const [langFilter, setLangFilter] = useState<string | null>(null)

  useEffect(() => {
    const q    = searchParams.get('q') ?? ''
    const tags = searchParams.getAll('tag')
    const time = searchParams.get('time')
    const v    = (searchParams.get('view') as ViewMode) ?? 'grid'
    const s    = (searchParams.get('sort') as SortMode) ?? 'upcoming'
    const r    = searchParams.get('radius')
    const df   = searchParams.get('dateFrom') ?? ''
    const dt   = searchParams.get('dateTo')   ?? ''

    setSearch(q)
    setActiveFilters([...tags, ...(time ? [time] : [])])
    setDateFrom(df)
    setDateTo(dt)
    setView(v)
    setLastListView(v === 'list' ? 'list' : 'grid')
    setSort(s)
    setRadius(r ? (parseInt(r) as RadiusMiles) : null)
    if (df || dt) setShowDatePicker(true)
    setUrlSynced(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — run once on mount to read URL

  const [items, setItems] = useState<ItemWithDistance[]>([])
  const [loading, setLoading] = useState(true)

  const syncUrl = useCallback(
    (
      newSearch: string,
      newFilters: string[],
      newView: ViewMode,
      newSort: SortMode,
      newRadius: RadiusMiles | null,
      newDateFrom: string,
      newDateTo: string,
    ) => {
      const params = new URLSearchParams()
      if (newSearch) params.set('q', newSearch)
      const tagFilters = newFilters.filter((f) => !['today', 'this-week'].includes(f))
      const timeFilter = newFilters.find((f)  =>  ['today', 'this-week'].includes(f))
      tagFilters.forEach((t) => params.append('tag', t))
      if (timeFilter) params.set('time', timeFilter)
      if (newView !== 'grid') params.set('view', newView)
      if (newSort !== 'upcoming') params.set('sort', newSort)
      if (newRadius !== null) params.set('radius', String(newRadius))
      if (newDateFrom) params.set('dateFrom', newDateFrom)
      if (newDateTo)   params.set('dateTo',   newDateTo)
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [router, pathname],
  )

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ category: categorySlug, subcategory: subcategorySlug, sort })
      if (search) params.set('search', search)
      const tagFilters = activeFilters.filter((f) => !['today', 'this-week'].includes(f))
      const timeFilter = activeFilters.find((f) =>  ['today', 'this-week'].includes(f))
      tagFilters.forEach((t) => params.append('tag', t))
      if (timeFilter) params.set('time', timeFilter)
      if (radius !== null) {
        params.set('lat', String(UC_DAVIS_LAT))
        params.set('lng', String(UC_DAVIS_LNG))
        params.set('radius', String(radius))
      }
      // Date range — only when time preset is NOT active
      if (!timeFilter && dateFrom && dateTo) {
        params.set('dateFrom', dateFrom)
        params.set('dateTo',   dateTo)
      }
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) setItems(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [categorySlug, subcategorySlug, search, activeFilters, sort, radius, dateFrom, dateTo])

  useEffect(() => {
    if (urlSynced) fetchItems()
  }, [fetchItems, urlSynced])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleSearchChange(val: string) {
    setSearch(val); syncUrl(val, activeFilters, view, sort, radius, dateFrom, dateTo)
  }

  function handleFilterToggle(val: string) {
    let next: string[]
    if (['today', 'this-week'].includes(val)) {
      const without = activeFilters.filter((f) => !['today', 'this-week'].includes(f))
      next = activeFilters.includes(val) ? without : [...without, val]
    } else {
      next = activeFilters.includes(val) ? activeFilters.filter((f) => f !== val) : [...activeFilters, val]
    }
    setActiveFilters(next); syncUrl(search, next, view, sort, radius, dateFrom, dateTo)
  }

  function handleRemoveFilter(val: string) {
    const next = activeFilters.filter((f) => f !== val)
    setActiveFilters(next); syncUrl(search, next, view, sort, radius, dateFrom, dateTo)
  }

  function handleViewChange(v: ViewMode) {
    setView(v)
    if (v !== 'map') setLastListView(v as 'grid' | 'list')
    syncUrl(search, activeFilters, v, sort, radius, dateFrom, dateTo)
  }

  function handleSortChange(s: SortMode) {
    setSort(s); syncUrl(search, activeFilters, view, s, radius, dateFrom, dateTo)
  }

  function handleRadiusChange(r: RadiusMiles | null) {
    setRadius(r); syncUrl(search, activeFilters, view, sort, r, dateFrom, dateTo)
  }

  function handleDateChange(from: string, to: string) {
    setDateFrom(from); setDateTo(to)
    syncUrl(search, activeFilters, view, sort, radius, from, to)
  }

  function handleClearDates() {
    setDateFrom(''); setDateTo('')
    syncUrl(search, activeFilters, view, sort, radius, '', '')
  }

  function handleClearAll() {
    setSearch(''); setActiveFilters([]); setDateFrom(''); setDateTo('')
    syncUrl('', [], view, sort, radius, '', '')
  }

  const hasActiveFilters = search || activeFilters.length > 0 || (dateFrom && dateTo)

  // ── Render ────────────────────────────────────────────────────────────────────

  const clearFiltersAction = (
    <div className="flex gap-3 flex-wrap justify-center">
      {hasActiveFilters && (
        <button
          onClick={handleClearAll}
          className="text-[14px] font-medium border border-[#E5E7EB] text-[#374151] px-4 py-2 rounded-full hover:bg-[#F9FAFB] transition-colors"
        >
          Clear Filters
        </button>
      )}
      <Link href="/submit" className="text-[14px] font-medium bg-[#111111] text-white px-4 py-2 rounded-full hover:bg-[#333] transition-colors">
        Submit a Listing
      </Link>
    </div>
  )

  const isEvents = categorySlug === 'events'

  // Language filter — client-side only, applied on top of server results
  const EVENT_LANGUAGES = ['中文', 'Español', '한국어', 'Tiếng Việt', 'العربية', 'Français', 'Português', 'Filipino', 'हिन्दी']
  const displayedItems = (isEvents && langFilter)
    ? items.filter((item) => detectLanguages(item.title, item.description, item.tags ?? []).includes(langFilter))
    : items

  const listContent = loading ? (
    <div className={view === 'list' ? 'flex flex-col gap-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}>
      {Array.from({ length: 4 }).map((_, i) =>
        view === 'list' ? <SkeletonListCard key={i} /> : <SkeletonItemCard key={i} />
      )}
    </div>
  ) : displayedItems.length === 0 ? (
    hasActiveFilters || langFilter
      ? isEvents
        ? <NoEventsState action={clearFiltersAction} />
        : <NoResultsState action={clearFiltersAction} />
      : <NoListingsState action={clearFiltersAction} />
  ) : (
    <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'flex flex-col gap-3'}>
      {displayedItems.map((item) => <ItemCard key={item.id} item={item} view={view} />)}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Search + filters */}
      <div className="flex flex-col gap-3 animate-fade-up animate-fade-up-delay-1">
        <SearchBar value={search} onChange={handleSearchChange} placeholder={`Search in ${subcategoryLabel}...`} />

        {/* Quick filter pills + date range toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <QuickFilters activeFilters={activeFilters} onToggle={handleFilterToggle} filters={TAG_QUICK_FILTERS} />
          <button
            onClick={() => setShowDatePicker((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all duration-150',
              showDatePicker || (dateFrom && dateTo)
                ? 'bg-[#111111] text-white border-[#111111]'
                : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]',
            )}
          >
            <CalendarRange className="w-3.5 h-3.5" />
            Date Range
          </button>
        </div>

        {/* Date range picker — shown when toggled */}
        {showDatePicker && (
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={handleDateChange}
            onClear={handleClearDates}
          />
        )}

        {/* Language filter — events only, collapsed by default */}
        {isEvents && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowLangFilter((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all duration-150',
                  showLangFilter || langFilter
                    ? 'bg-[#111111] text-white border-[#111111]'
                    : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]',
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                {langFilter ? langFilter : 'Language'}
              </button>
              {langFilter && (
                <button
                  onClick={() => { setLangFilter(null); setShowLangFilter(false) }}
                  className="flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
            {showLangFilter && (
              <div className="flex items-center gap-2 flex-wrap pl-1">
                {EVENT_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => { setLangFilter(langFilter === lang ? null : lang); setShowLangFilter(false) }}
                    className={cn(
                      'text-[12px] font-medium rounded-full px-3 py-1 border transition-all duration-150',
                      langFilter === lang
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-indigo-300 hover:text-indigo-600',
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active filter chips */}
        <ActiveChips
          filters={activeFilters}
          dateFrom={dateFrom}
          dateTo={dateTo}
          search={search}
          onRemoveFilter={handleRemoveFilter}
          onClearDates={handleClearDates}
          onClearAll={handleClearAll}
        />
      </div>

      {/* Radius */}
      <div className="animate-fade-up animate-fade-up-delay-2">
        <RadiusSelector value={radius} onChange={handleRadiusChange} />
      </div>

      {/* Controls */}
      <div className="animate-fade-up animate-fade-up-delay-2">
        <ItemListControls
          view={view}
          onViewChange={handleViewChange}
          sort={sort}
          onSortChange={handleSortChange}
          count={loading ? 0 : items.length}
          lastListView={lastListView}
        />
      </div>

      {/* Map or List */}
      {view === 'map' ? (
        <MapView items={items} />
      ) : (
        listContent
      )}
    </div>
  )
}
