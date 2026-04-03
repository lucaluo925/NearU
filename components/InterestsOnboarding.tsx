'use client'

import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useInterests, InterestsStore } from '@/hooks/useInterests'
import { cn } from '@/lib/utils'

// ── Interest options ──────────────────────────────────────────────────────────

const CUISINE_OPTIONS = [
  { tag: 'thai',          label: '🍜 Thai' },
  { tag: 'chinese',       label: '🥢 Chinese' },
  { tag: 'japanese',      label: '🍱 Japanese' },
  { tag: 'vietnamese',    label: '🍲 Vietnamese' },
  { tag: 'mexican',       label: '🌮 Mexican' },
  { tag: 'indian',        label: '🍛 Indian' },
  { tag: 'italian',       label: '🍝 Italian' },
  { tag: 'american',      label: '🍔 American' },
  { tag: 'pizza',         label: '🍕 Pizza' },
  { tag: 'mediterranean', label: '🥗 Mediterranean' },
  { tag: 'korean',        label: '🥩 Korean' },
  { tag: 'vegan',         label: '🌱 Vegan' },
]

const VIBE_OPTIONS = [
  { tag: 'study-friendly',   label: '📚 Study Friendly' },
  { tag: 'student-friendly', label: '🎓 Student Friendly' },
  { tag: 'outdoor-seating',  label: '🌿 Outdoor' },
  { tag: 'late-night',       label: '🌙 Late Night' },
  { tag: 'group-friendly',   label: '👥 Groups' },
  { tag: 'date-night',       label: '💑 Date Night' },
  { tag: 'live-music',       label: '🎵 Live Music' },
  { tag: 'cozy',             label: '☕ Cozy' },
  { tag: 'sports',           label: '🏆 Sports' },
]

const PRICE_OPTIONS = [
  { tag: 'free',      label: '🆓 Free' },
  { tag: 'cheap',     label: '💰 Budget' },
  { tag: 'moderate',  label: '💵 Moderate' },
  { tag: 'splurge',   label: '✨ Splurge' },
]

const CATEGORY_OPTIONS = [
  { tag: 'food',    label: '🍽 Food & Dining' },
  { tag: 'events',  label: '🎉 Events' },
  { tag: 'arts',    label: '🎨 Arts & Culture' },
  { tag: 'sports',  label: '⚽ Sports' },
  { tag: 'outdoor', label: '🥾 Outdoors' },
]

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-[13px] font-medium rounded-full px-3.5 py-1.5 border transition-all duration-150',
        active
          ? 'bg-[#111111] text-white border-[#111111]'
          : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]',
      )}
    >
      {label}
    </button>
  )
}

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when user saves or dismisses */
  onClose?: () => void
}

export default function InterestsOnboarding({ onClose }: Props) {
  const { save, dismiss } = useInterests()

  const [cuisines,    setCuisines]    = useState<string[]>([])
  const [vibes,       setVibes]       = useState<string[]>([])
  const [prices,      setPrices]      = useState<string[]>([])
  const [categories,  setCategories]  = useState<string[]>([])

  function handleSave() {
    save({ cuisines, vibes, prices, categories })
    onClose?.()
  }

  function handleDismiss() {
    dismiss()
    onClose?.()
  }

  const totalSelected = cuisines.length + vibes.length + prices.length + categories.length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleDismiss} />

      {/* Panel */}
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-[540px] max-h-[90dvh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-[#F3F4F6] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#FEF9C3] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[#D97706]" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-[#111111]">Personalize Your Feed</h2>
              <p className="text-[12px] text-[#9CA3AF]">Pick what you&apos;re into — skip anything</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-full bg-[#F3F4F6] flex items-center justify-center hover:bg-[#E5E7EB] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-[#6B7280]" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Categories */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2.5">I&apos;m mostly interested in…</h3>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(({ tag, label }) => (
                <Chip
                  key={tag}
                  label={label}
                  active={categories.includes(tag)}
                  onClick={() => setCategories(toggle(categories, tag))}
                />
              ))}
            </div>
          </section>

          {/* Cuisine */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2.5">Favourite cuisines</h3>
            <div className="flex flex-wrap gap-2">
              {CUISINE_OPTIONS.map(({ tag, label }) => (
                <Chip
                  key={tag}
                  label={label}
                  active={cuisines.includes(tag)}
                  onClick={() => setCuisines(toggle(cuisines, tag))}
                />
              ))}
            </div>
          </section>

          {/* Vibe */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2.5">Vibe</h3>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map(({ tag, label }) => (
                <Chip
                  key={tag}
                  label={label}
                  active={vibes.includes(tag)}
                  onClick={() => setVibes(toggle(vibes, tag))}
                />
              ))}
            </div>
          </section>

          {/* Price */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2.5">Budget</h3>
            <div className="flex flex-wrap gap-2">
              {PRICE_OPTIONS.map(({ tag, label }) => (
                <Chip
                  key={tag}
                  label={label}
                  active={prices.includes(tag)}
                  onClick={() => setPrices(toggle(prices, tag))}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Footer CTA */}
        <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-[#F3F4F6] px-6 py-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-[#111111] text-white text-[14px] font-semibold py-3 rounded-2xl hover:bg-[#333] transition-colors"
          >
            {totalSelected > 0 ? `Save ${totalSelected} interest${totalSelected !== 1 ? 's' : ''}` : 'Save preferences'}
          </button>
          <button
            onClick={handleDismiss}
            className="text-[13px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
