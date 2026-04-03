'use client'

import { CalendarPlus } from 'lucide-react'
import { awardPoints } from '@/hooks/usePoints'
import { awardPetXP } from '@/hooks/usePet'
import { useToast } from '@/components/Toast'

interface Props {
  itemId: string
  className?: string
}

/**
 * CalendarButton — wraps the .ical download link and awards add_to_calendar
 * points (3 pts, rate-limited, deduplicated by item) when clicked.
 */
export default function CalendarButton({ itemId, className }: Props) {
  const { show } = useToast()

  async function handleClick() {
    const [result, petResult] = await Promise.all([
      awardPoints('add_to_calendar', { item_id: itemId }),
      awardPetXP('add_to_calendar'),
    ])
    if (!result.skipped && result.points > 0) {
      show(`+${result.points} pts — Added to calendar 🗓️`)
    }
    window.dispatchEvent(
      new CustomEvent('pet:react', {
        detail: {
          type:   (petResult as { level_up?: boolean } | null)?.level_up ? 'celebrate' : 'bounce',
          action: 'calendar',
          bond:   2,
        },
      }),
    )
  }

  return (
    <a
      href={`/api/items/${itemId}/ical`}
      download
      onClick={handleClick}
      className={
        className ??
        'flex items-center justify-center gap-2 bg-white border border-[#E5E7EB] text-[#374151] text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#F9FAFB] active:scale-[0.99] transition-all duration-150'
      }
    >
      <CalendarPlus className="w-4 h-4" />
      Add to Calendar
    </a>
  )
}
