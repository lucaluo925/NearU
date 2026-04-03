'use client'

import { cn } from '@/lib/utils'

interface QuickFiltersProps {
  activeFilters: string[]
  onToggle: (value: string) => void
  filters?: { label: string; value: string }[]
}

const DEFAULT_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'Free', value: 'free' },
  { label: 'Outdoor', value: 'outdoor' },
  { label: 'Student-Friendly', value: 'student-friendly' },
]

export default function QuickFilters({ activeFilters, onToggle, filters = DEFAULT_FILTERS }: QuickFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => {
        const active = activeFilters.includes(filter.value)
        return (
          <button
            key={filter.value}
            onClick={() => onToggle(filter.value)}
            className={cn(
              'text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all duration-150',
              active
                ? 'bg-[#111111] text-white border-[#111111]'
                : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
            )}
          >
            {filter.label}
          </button>
        )
      })}
    </div>
  )
}
