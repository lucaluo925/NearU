import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RatingBadgeProps {
  avgRating?: number | null
  reviewCount?: number
  size?: 'xs' | 'sm' | 'md'
  showEmpty?: boolean
  className?: string
}

export default function RatingBadge({
  avgRating,
  reviewCount = 0,
  size = 'sm',
  showEmpty = false,
  className,
}: RatingBadgeProps) {
  const hasRating = avgRating != null && avgRating > 0

  if (!hasRating) {
    if (!showEmpty) return null
    return (
      <span className={cn('text-[11px] text-[#9CA3AF]', className)}>
        No ratings yet
      </span>
    )
  }

  const starSz  = size === 'md' ? 'w-3.5 h-3.5' : size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'
  const textSz  = size === 'md' ? 'text-[14px]'  : size === 'xs' ? 'text-[10px]' : 'text-[12px]'
  const countSz = size === 'md' ? 'text-[13px]'  : size === 'xs' ? 'text-[10px]' : 'text-[11px]'

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Star className={cn(starSz, 'fill-amber-400 text-amber-400 shrink-0')} />
      <span className={cn(textSz, 'font-semibold text-[#374151]')}>
        {avgRating.toFixed(1)}
      </span>
      {reviewCount > 0 && (
        <span className={cn(countSz, 'text-[#9CA3AF]')}>
          ({reviewCount})
        </span>
      )}
    </span>
  )
}
