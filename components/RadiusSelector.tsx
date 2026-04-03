'use client'

import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RADIUS_OPTIONS, RadiusMiles } from '@/lib/types'

interface RadiusSelectorProps {
  value: RadiusMiles | null
  onChange: (value: RadiusMiles | null) => void
  className?: string
}

export default function RadiusSelector({ value, onChange, className }: RadiusSelectorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
      <div className="flex items-center bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => onChange(null)}
          className={cn(
            'px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap',
            value === null
              ? 'bg-[#111111] text-white'
              : 'text-[#6B7280] hover:text-[#374151]'
          )}
        >
          Any
        </button>
        {RADIUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            className={cn(
              'px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap border-l border-[#F3F4F6]',
              value === opt.value
                ? 'bg-[#111111] text-white'
                : 'text-[#6B7280] hover:text-[#374151]'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
