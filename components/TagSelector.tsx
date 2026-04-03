'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { PREDEFINED_TAGS } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface TagSelectorProps {
  value: string[]
  onChange: (tags: string[]) => void
  maxCustom?: number
}

export default function TagSelector({ value, onChange, maxCustom = 3 }: TagSelectorProps) {
  const [customInput, setCustomInput] = useState('')

  const customTags = value.filter((t) => !PREDEFINED_TAGS.includes(t))
  const canAddCustom = customTags.length < maxCustom

  function toggleTag(tag: string) {
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag))
    } else {
      onChange([...value, tag])
    }
  }

  function addCustomTag() {
    const normalized = customInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (!normalized || value.includes(normalized) || !canAddCustom) return
    onChange([...value, normalized])
    setCustomInput('')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Predefined tags */}
      <div className="flex flex-wrap gap-2">
        {PREDEFINED_TAGS.map((tag) => {
          const active = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={cn(
                'text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all duration-150',
                active
                  ? 'bg-[#111111] text-white border-[#111111]'
                  : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB]'
              )}
            >
              {tag}
            </button>
          )
        })}
      </div>

      {/* Selected custom tags */}
      {customTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1.5 text-[13px] font-medium bg-[#111111] text-white rounded-full px-3 py-1.5"
            >
              {tag}
              <button type="button" onClick={() => toggleTag(tag)} aria-label={`Remove ${tag}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Custom tag input */}
      {canAddCustom && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustomTag() }
            }}
            placeholder={`Add custom tag (${maxCustom - customTags.length} left)`}
            className="flex-1 bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-2 text-[13px] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111111]/10 focus:border-[#D1D5DB] transition-all"
            maxLength={30}
          />
          <button
            type="button"
            onClick={addCustomTag}
            disabled={!customInput.trim() || !canAddCustom}
            className="flex items-center gap-1 text-[13px] font-medium border border-[#E5E7EB] text-[#374151] rounded-xl px-3 py-2 hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      )}

      {!canAddCustom && (
        <p className="text-[12px] text-[#9CA3AF]">Maximum {maxCustom} custom tags reached.</p>
      )}
    </div>
  )
}
