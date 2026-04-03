'use client'

import { MapPin, Navigation } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MapButtonsProps {
  googleUrl: string
  appleUrl: string
  size?: 'sm' | 'lg'
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

/**
 * Consistent map action buttons used across cards and the detail page.
 * sm — compact, for card footers
 * lg — full-width, for the detail page
 */
export default function MapButtons({ googleUrl, appleUrl, size = 'sm', className, onClick }: MapButtonsProps) {
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); onClick?.(e) }

  if (size === 'lg') {
    return (
      <div className={cn('grid grid-cols-2 gap-3', className)}>
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center justify-center gap-2.5',
            'bg-white border border-[#E5E7EB] text-[#111111]',
            'text-[14px] font-semibold py-3.5 rounded-2xl',
            'hover:bg-[#F7F7F8] hover:border-[#D1D5DB] hover:shadow-md',
            'active:scale-[0.98]',
            'transition-all duration-150',
          )}
          onClick={stop}
        >
          <MapPin className="w-[17px] h-[17px] text-[#6B7280]" strokeWidth={1.75} />
          Google Maps
        </a>
        <a
          href={appleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center justify-center gap-2.5',
            'bg-white border border-[#E5E7EB] text-[#111111]',
            'text-[14px] font-semibold py-3.5 rounded-2xl',
            'hover:bg-[#F7F7F8] hover:border-[#D1D5DB] hover:shadow-md',
            'active:scale-[0.98]',
            'transition-all duration-150',
          )}
          onClick={stop}
        >
          <Navigation className="w-[17px] h-[17px] text-[#6B7280]" strokeWidth={1.75} />
          Apple Maps
        </a>
      </div>
    )
  }

  // sm — card footer
  return (
    <div className={cn('flex gap-1.5', className)}>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open in Google Maps"
        title="Google Maps"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl',
          'text-[11px] font-semibold text-[#374151]',
          'bg-white border border-[#E5E7EB]',
          'hover:bg-[#F7F7F8] hover:border-[#D1D5DB] hover:shadow-sm',
          'active:scale-[0.97]',
          'transition-all duration-150 whitespace-nowrap',
        )}
        onClick={stop}
      >
        <MapPin className="w-3 h-3 text-[#6B7280]" strokeWidth={2} />
        Maps
      </a>
      <a
        href={appleUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open in Apple Maps"
        title="Apple Maps"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl',
          'text-[11px] font-semibold text-[#374151]',
          'bg-white border border-[#E5E7EB]',
          'hover:bg-[#F7F7F8] hover:border-[#D1D5DB] hover:shadow-sm',
          'active:scale-[0.97]',
          'transition-all duration-150 whitespace-nowrap',
        )}
        onClick={stop}
      >
        <Navigation className="w-3 h-3 text-[#6B7280]" strokeWidth={2} />
        Directions
      </a>
    </div>
  )
}
