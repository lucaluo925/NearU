'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Heart, CalendarPlus, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { useFavorites, DEFAULT_COLLECTIONS } from '@/hooks/useFavorites'
import ItemCard from '@/components/ItemCard'
import { SkeletonItemCard } from '@/components/SkeletonCard'
import { Item } from '@/lib/types'
import { cn } from '@/lib/utils'

// ── ICS batch export for a collection of events ───────────────────────────────

function foldLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  while (rest.length > 75) { chunks.push(rest.slice(0, 75)); rest = ' ' + rest.slice(75) }
  chunks.push(rest)
  return chunks.join('\r\n')
}

function escapeICS(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function formatICSDate(d: string) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z')
}

function exportCollectionICS(items: Item[], collectionName: string) {
  const events = items.filter((i) => i.start_time)
  if (events.length === 0) return

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NearU//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  const now = formatICSDate(new Date().toISOString())

  for (const item of events) {
    const dtstart = formatICSDate(item.start_time!)
    const dtend   = item.end_time ? formatICSDate(item.end_time) : dtstart
    const loc     = [item.location_name, item.address].filter(Boolean).join(', ')
    lines.push(
      'BEGIN:VEVENT',
      foldLine(`UID:aggiemap-${item.id}@aggiemap.app`),
      `DTSTAMP:${now}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      foldLine(`SUMMARY:${escapeICS(item.title)}`),
      ...(item.description ? [foldLine(`DESCRIPTION:${escapeICS(item.description)}`)] : []),
      ...(loc ? [foldLine(`LOCATION:${escapeICS(loc)}`)] : []),
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${collectionName.toLowerCase().replace(/\s+/g, '-')}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Collection section ────────────────────────────────────────────────────────

interface CollectionSectionProps {
  name: string
  items: Item[]
  defaultOpen?: boolean
}

function CollectionSection({ name, items, defaultOpen = true }: CollectionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const eventItems = items.filter((i) => i.start_time)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left group"
        >
          <h2 className="text-[16px] font-bold text-[#111111] group-hover:text-[#374151] transition-colors">
            {name}
          </h2>
          <span className="text-[12px] text-[#9CA3AF] font-normal">
            {items.length} saved
          </span>
          {open
            ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" />
            : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
        </button>

        {eventItems.length > 0 && (
          <button
            onClick={() => exportCollectionICS(items, name)}
            title={`Export ${eventItems.length} event${eventItems.length !== 1 ? 's' : ''} as .ics`}
            className="flex items-center gap-1.5 text-[12px] text-[#6B7280] border border-[#E5E7EB] rounded-full px-3 py-1 hover:bg-[#F9FAFB] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Calendar
          </button>
        )}
      </div>

      {open && (
        items.length === 0 ? (
          <p className="text-[13px] text-[#9CA3AF] italic pl-1">No items saved here yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} view="grid" />
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

export default function FavoritesClient() {
  const { store, favorites, hydrated } = useFavorites()
  const [itemMap, setItemMap] = useState<Record<string, Item>>({})
  const [loading, setLoading] = useState(false)

  // Stable dep: join IDs into a string so a new array reference with same IDs
  // doesn't re-trigger the effect (which would cause an infinite render loop).
  const favoritesKey = favorites.join(',')

  useEffect(() => {
    if (!hydrated) return
    if (favorites.length === 0) { setItemMap({}); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all(
      favorites.map((id) =>
        fetch(`/api/items/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return
      const map: Record<string, Item> = {}
      for (const item of results) {
        if (item && typeof item === 'object' && item.id) map[item.id] = item as Item
      }
      setItemMap(map)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [favoritesKey, hydrated])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated || loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonItemCard key={i} />)}
      </div>
    )
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-20 px-6">
        <div className="w-14 h-14 rounded-2xl bg-[#FFF1F2] flex items-center justify-center mb-4">
          <Heart className="w-6 h-6 text-red-300" />
        </div>
        <h3 className="text-[16px] font-semibold text-[#111111] mb-2">No saved listings yet</h3>
        <p className="text-[14px] text-[#6B7280] max-w-[280px] leading-relaxed mb-6">
          Tap the heart on any listing to save it here. You can organize saves into collections.
        </p>
        <Link
          href="/"
          className="text-[14px] font-semibold bg-[#111111] text-white px-5 py-2.5 rounded-full hover:bg-[#333] transition-colors"
        >
          Browse Listings
        </Link>
      </div>
    )
  }

  const collectionNames = Object.keys(store.collections)
  const allEventItems   = favorites.map((id) => itemMap[id]).filter((i): i is Item => !!i && !!i.start_time)

  return (
    <div className="flex flex-col gap-8">
      {/* Top summary */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-[#6B7280]">
          {favorites.length} saved · {collectionNames.length} collection{collectionNames.length !== 1 ? 's' : ''}
        </p>
        {allEventItems.length > 0 && (
          <button
            onClick={() => exportCollectionICS(allEventItems, 'aggie-map-favorites')}
            className="flex items-center gap-1.5 text-[13px] font-medium text-[#374151] border border-[#E5E7EB] rounded-full px-4 py-1.5 hover:bg-[#F9FAFB] transition-colors"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            Export All Events
          </button>
        )}
      </div>

      {/* Collections */}
      {collectionNames.map((name, idx) => {
        const ids   = store.collections[name] ?? []
        const items = ids.map((id) => itemMap[id]).filter((i): i is Item => !!i)
        return (
          <CollectionSection
            key={name}
            name={name}
            items={items}
            defaultOpen={idx === 0}
          />
        )
      })}

      {/* Items not in any named collection (safety net) */}
      {(() => {
        const allCollectionIds = new Set(Object.values(store.collections).flat())
        const orphans = favorites.filter((id) => !allCollectionIds.has(id)).map((id) => itemMap[id]).filter((i): i is Item => !!i)
        if (orphans.length === 0) return null
        return (
          <CollectionSection name="Other" items={orphans} defaultOpen />
        )
      })()}
    </div>
  )
}
