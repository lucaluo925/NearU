'use client'

import { useState, useRef, useEffect } from 'react'
import { Heart, Check } from 'lucide-react'
import { track } from '@vercel/analytics'
import { useFavorites, DEFAULT_COLLECTIONS } from '@/hooks/useFavorites'
import { useToast } from '@/components/Toast'
import { cn } from '@/lib/utils'

interface FavoriteButtonProps {
  id: string
  category?: string
  className?: string
}

export default function FavoriteButton({ id, category, className }: FavoriteButtonProps) {
  const { isFavorite, getCollection, toggle, moveToCollection, hydrated, collectionNames } = useFavorites()
  const { show } = useToast()
  const saved = hydrated && isFavorite(id)
  const currentCollection = getCollection(id)

  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPicker) return
    function onOutside(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showPicker])

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (saved) {
      // Un-save immediately
      toggle(id)
      setShowPicker(false)
    } else {
      // Show collection picker
      setShowPicker((v) => !v)
    }
  }

  function handlePickCollection(collection: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (saved && currentCollection === collection) {
      // Already in this collection — remove
      toggle(id, collection)
    } else if (saved) {
      // Move to different collection
      moveToCollection(id, collection)
    } else {
      // Add to collection — show points toast
      fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, type: 'favorite' }),
      }).catch(() => {})
      toggle(id, collection)
      track('favorite', { item_id: id, category: category ?? '' })
      show('+2 pts — Saved ❤️')
    }
    setShowPicker(false)
  }

  const collections = collectionNames.length > 0 ? collectionNames : [...DEFAULT_COLLECTIONS]

  return (
    <div className="relative" ref={pickerRef}>
      <button
        onClick={handleClick}
        aria-label={saved ? 'Remove from favorites' : 'Save to favorites'}
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150',
          saved
            ? 'bg-red-50 text-red-500 hover:bg-red-100'
            : 'bg-white/80 backdrop-blur-sm text-[#C4C9D4] hover:text-red-400 hover:bg-red-50 border border-[#E5E7EB]',
          className,
        )}
      >
        <Heart className={cn('w-4 h-4', saved && 'fill-current')} />
      </button>

      {/* Collection picker popup */}
      {showPicker && (
        <div
          className="absolute right-0 top-10 z-50 bg-white border border-[#E5E7EB] rounded-2xl shadow-lg p-2 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider px-2 py-1">
            Save to…
          </p>
          {collections.map((col) => (
            <button
              key={col}
              onClick={(e) => handlePickCollection(col, e)}
              className="flex items-center justify-between w-full text-left text-[13px] text-[#374151] hover:bg-[#F9FAFB] rounded-xl px-3 py-2 transition-colors gap-2"
            >
              <span>{col}</span>
              {currentCollection === col && (
                <Check className="w-3.5 h-3.5 text-red-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
