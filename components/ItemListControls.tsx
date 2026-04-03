'use client'

import { LayoutGrid, List, ArrowUpDown, Map as MapIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ViewMode, SortMode } from '@/lib/types'

interface ItemListControlsProps {
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  sort: SortMode
  onSortChange: (sort: SortMode) => void
  count: number
  /** Last non-map view — used to restore when switching back from map */
  lastListView?: 'grid' | 'list'
}

export default function ItemListControls({
  view,
  onViewChange,
  sort,
  onSortChange,
  count,
  lastListView = 'grid',
}: ItemListControlsProps) {
  const isMap = view === 'map'

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* Left: result count + sort context */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-[#6B7280]">
          {count === 0 ? 'No results' : `${count} result${count !== 1 ? 's' : ''}`}
        </span>
        {!isMap && sort === 'top-rated' && (
          <span className="text-[11px] text-[#9CA3AF]">Ranked by user ratings</span>
        )}
        {!isMap && sort === 'popular' && (
          <span className="text-[11px] text-[#9CA3AF]">Ranked by saves &amp; views</span>
        )}
        {!isMap && sort === 'best-nearby' && (
          <span className="text-[11px] text-[#9CA3AF]">Combines distance, rating &amp; popularity</span>
        )}
        {!isMap && sort === 'nearest' && (
          <span className="text-[11px] text-[#9CA3AF]">Closest to your location</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Sort — hidden in map mode */}
        {!isMap && (
          <>
            <div className="flex items-center gap-1.5 text-[13px] text-[#6B7280]">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <select
                value={sort}
                onChange={(e) => onSortChange(e.target.value as SortMode)}
                className="bg-transparent border-none outline-none text-[13px] text-[#374151] font-medium cursor-pointer"
              >
                <option value="upcoming">Upcoming</option>
                <option value="newest">Newest</option>
                <option value="nearest">Nearest</option>
                <option value="top-rated">Top Rated</option>
                <option value="popular">Most Popular</option>
                <option value="best-nearby">Best Nearby</option>
              </select>
            </div>
            <div className="w-px h-4 bg-[#E5E7EB]" />
          </>
        )}

        {/* List / Map primary toggle — prominent pill */}
        <div className="flex items-center bg-[#F3F4F6] rounded-xl p-0.5">
          <button
            onClick={() => onViewChange(lastListView)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-medium transition-all duration-150',
              !isMap
                ? 'bg-white text-[#111111] shadow-sm'
                : 'text-[#6B7280] hover:text-[#374151]'
            )}
          >
            <List className="w-3.5 h-3.5" />
            List
          </button>
          <button
            onClick={() => onViewChange('map')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-medium transition-all duration-150',
              isMap
                ? 'bg-white text-[#111111] shadow-sm'
                : 'text-[#6B7280] hover:text-[#374151]'
            )}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Map
          </button>
        </div>

        {/* Grid / List sub-toggle — only visible in list mode */}
        {!isMap && (
          <>
            <div className="w-px h-4 bg-[#E5E7EB]" />
            <div className="flex items-center bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => onViewChange('grid')}
                className={cn(
                  'p-1.5 transition-colors',
                  view === 'grid' ? 'bg-[#111111] text-white' : 'text-[#9CA3AF] hover:text-[#6B7280]'
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onViewChange('list')}
                className={cn(
                  'p-1.5 transition-colors',
                  view === 'list' ? 'bg-[#111111] text-white' : 'text-[#9CA3AF] hover:text-[#6B7280]'
                )}
                aria-label="List view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
