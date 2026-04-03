'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMapEvents, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Link from 'next/link'
import { MapPin, X } from 'lucide-react'
import { ItemWithDistance, UC_DAVIS_LAT, UC_DAVIS_LNG } from '@/lib/types'
import { formatDistance, formatDateTime } from '@/lib/utils'
import { getCategoryBySlug } from '@/lib/constants'
import { getTagStyle, tagLabel } from '@/lib/tags'
import { cn } from '@/lib/utils'

// ── Category colors ───────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  events:   '#3B82F6',
  food:     '#F97316',
  outdoor:  '#22C55E',
  study:    '#8B5CF6',
  shopping: '#EC4899',
  campus:   '#6366F1',
}

// ── Icon factories ────────────────────────────────────────────────────────────

function makePinIcon(color: string, size: number, active: boolean) {
  const glow = active ? `box-shadow:0 0 0 4px ${color}40,0 3px 14px rgba(0,0,0,0.35);` : 'box-shadow:0 2px 8px rgba(0,0,0,0.28);'
  const border = active ? 3 : 2.5
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:${border}px solid white;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      ${glow}
      transition:all 0.15s ease;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  })
}

function makeClusterIcon(count: number, color: string) {
  const size = count >= 100 ? 52 : count >= 20 ? 44 : 36
  const fs = count >= 100 ? 11 : 13
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:${size}px;height:${size}px">
      <div class="cluster-pulse" style="
        position:absolute;inset:0;
        background:${color}30;
        border-radius:50%;
      "></div>
      <div style="
        position:absolute;inset:4px;
        background:${color};
        border:2.5px solid white;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font:bold ${fs}px/1 system-ui,sans-serif;
        color:white;
        box-shadow:0 2px 10px rgba(0,0,0,0.28);
        cursor:pointer;
      ">${count}</div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ── Spatial clustering ────────────────────────────────────────────────────────

interface ClusterGroup {
  id: string
  lat: number
  lng: number
  members: ItemWithDistance[]
  dominantCategory: string
}

function computeClusters(items: ItemWithDistance[], map: L.Map, radius = 44): ClusterGroup[] {
  const positioned = items.filter(i => i.latitude != null && i.longitude != null)
  const unassigned = new Set(positioned.map(i => i.id))
  const result: ClusterGroup[] = []

  for (const item of positioned) {
    if (!unassigned.has(item.id)) continue
    unassigned.delete(item.id)

    const px = map.latLngToLayerPoint([item.latitude!, item.longitude!])
    const members: ItemWithDistance[] = [item]

    for (const other of positioned) {
      if (!unassigned.has(other.id)) continue
      const opx = map.latLngToLayerPoint([other.latitude!, other.longitude!])
      if (Math.hypot(px.x - opx.x, px.y - opx.y) <= radius) {
        unassigned.delete(other.id)
        members.push(other)
      }
    }

    const lat = members.reduce((s, m) => s + m.latitude!, 0) / members.length
    const lng = members.reduce((s, m) => s + m.longitude!, 0) / members.length
    const catCounts: Record<string, number> = {}
    members.forEach(m => { catCounts[m.category] = (catCounts[m.category] ?? 0) + 1 })
    const dominantCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0]

    result.push({ id: members.map(m => m.id).sort().join('|'), lat, lng, members, dominantCategory })
  }
  return result
}

// ── ClusterLayer — must live inside MapContainer ──────────────────────────────

function ClusterLayer({
  items, selectedId, hoveredId, onSelect, onMapHover,
}: {
  items: ItemWithDistance[]
  selectedId: string | null
  hoveredId: string | null
  onSelect: (item: ItemWithDistance | null) => void
  onMapHover: (id: string | null) => void
}) {
  const map = useMap()
  const [clusters, setClusters] = useState<ClusterGroup[]>([])

  const recompute = useCallback(() => setClusters(computeClusters(items, map)), [items, map])

  useEffect(() => { recompute() }, [recompute])
  useMapEvents({ zoomend: recompute, moveend: recompute })

  return (
    <>
      {clusters.map(cluster => {
        const color = CATEGORY_COLORS[cluster.dominantCategory] ?? '#6B7280'

        if (cluster.members.length > 1) {
          return (
            <Marker
              key={cluster.id}
              position={[cluster.lat, cluster.lng]}
              icon={makeClusterIcon(cluster.members.length, color)}
              eventHandlers={{
                click(e) {
                  e.originalEvent.stopPropagation()
                  map.flyTo([cluster.lat, cluster.lng], map.getZoom() + 2, { animate: true, duration: 0.4 })
                },
              }}
            />
          )
        }

        const item = cluster.members[0]
        const isSelected = selectedId === item.id
        const isHovered = hoveredId === item.id
        const size = isSelected ? 34 : isHovered ? 30 : 26
        const tags = (item.tags ?? []).slice(0, 3)

        return (
          <Marker
            key={cluster.id}
            position={[cluster.lat, cluster.lng]}
            icon={makePinIcon(color, size, isSelected || isHovered)}
            zIndexOffset={isSelected ? 1000 : isHovered ? 500 : 0}
            eventHandlers={{
              click(e) {
                e.originalEvent.stopPropagation()
                onSelect(isSelected ? null : item)
              },
              mouseover() { onMapHover(item.id) },
              mouseout() { onMapHover(null) },
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -(size + 4)]}
              permanent={false}
              className="aggie-tooltip"
            >
              <div style={{ minWidth: 160, maxWidth: 220 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111', marginBottom: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {item.title}
                </div>
                {item.description && (
                  <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {item.description}
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                    {tags.map(t => (
                      <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: '#F3F4F6', color: '#6B7280', fontWeight: 500 }}>
                        {tagLabel(t)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Tooltip>
          </Marker>
        )
      })}
    </>
  )
}

function FlyToSelected({ item }: { item: ItemWithDistance | null }) {
  const map = useMap()
  const prevId = useRef<string | null>(null)
  useEffect(() => {
    if (item && item.id !== prevId.current && item.latitude && item.longitude) {
      map.flyTo([item.latitude, item.longitude], Math.max(map.getZoom(), 15), { animate: true, duration: 0.5 })
    }
    prevId.current = item?.id ?? null
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function MapClickClear({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: onClear })
  return null
}

// ── Left panel list item ──────────────────────────────────────────────────────

function MapListItem({
  item, selected, hovered, onSelect, onHover, itemRef,
}: {
  item: ItemWithDistance
  selected: boolean
  hovered: boolean
  onSelect: (item: ItemWithDistance) => void
  onHover: (id: string | null) => void
  itemRef: (el: HTMLDivElement | null) => void
}) {
  const cat = getCategoryBySlug(item.category)
  const color = CATEGORY_COLORS[item.category] ?? '#6B7280'
  const tags = (item.tags ?? []).slice(0, 3)

  return (
    <div
      ref={itemRef}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(item)}
      className={cn(
        'flex gap-3 px-3 py-3 cursor-pointer border-b border-[#F3F4F6] transition-colors select-none',
        selected ? 'bg-blue-50 border-l-[3px] border-l-blue-400 pl-[9px]' : hovered ? 'bg-[#F9FAFB]' : 'hover:bg-[#F9FAFB]'
      )}
    >
      <div className="shrink-0 mt-1.5">
        <div className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" style={{ background: color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[13px] font-semibold line-clamp-1', selected ? 'text-blue-900' : 'text-[#111111]')}>
          {item.title}
        </p>
        {item.description && (
          <p className="text-[11px] text-[#6B7280] line-clamp-1 mt-0.5">{item.description}</p>
        )}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="text-[10px] text-[#9CA3AF]">{cat?.icon} {cat?.label}</span>
          {item.distance_miles != null && (
            <span className="text-[10px] text-[#9CA3AF]">· {formatDistance(item.distance_miles)}</span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.map(t => (
              <span key={t} className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5', getTagStyle(t))}>
                {tagLabel(t)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Selected item bottom card ─────────────────────────────────────────────────

function SelectedCard({ item, onClose }: { item: ItemWithDistance; onClose: () => void }) {
  const cat = getCategoryBySlug(item.category)
  const tags = (item.tags ?? []).slice(0, 4)
  const dateStr = formatDateTime(item.start_time, item.end_time)

  return (
    <div className="absolute bottom-4 left-4 right-4 z-[1000] pointer-events-none">
      <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-xl p-4 pointer-events-auto animate-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280] rounded-full px-2 py-0.5">
                {cat?.icon} {cat?.label}
              </span>
              {item.distance_miles != null && (
                <span className="text-[11px] text-[#9CA3AF]">{formatDistance(item.distance_miles)}</span>
              )}
            </div>
            <h3 className="text-[15px] font-semibold text-[#111111] line-clamp-1 mb-0.5">{item.title}</h3>
            {item.description && (
              <p className="text-[12px] text-[#6B7280] line-clamp-2 mb-1.5">{item.description}</p>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map(t => (
                  <span key={t} className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5', getTagStyle(t))}>
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#9CA3AF] line-clamp-1">
              <MapPin className="inline w-3 h-3 mr-0.5 -mt-px" />
              {item.location_name ?? item.address}
            </p>
            {dateStr && (
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">{dateStr}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-7 h-7 rounded-full border border-[#E5E7EB] flex items-center justify-center hover:bg-[#F9FAFB] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-[#6B7280]" />
          </button>
        </div>
        <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
          <Link
            href={`/listing/${item.id}`}
            className="flex items-center justify-center text-[13px] font-semibold bg-[#111111] text-white rounded-xl py-2 hover:bg-[#333] active:scale-[0.99] transition-all"
          >
            View Details
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MapView({ items }: { items: ItemWithDistance[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const listRef = useRef<HTMLDivElement>(null)

  const mapped = items.filter(i => i.latitude != null && i.longitude != null)
  const selectedItem = mapped.find(i => i.id === selectedId) ?? null

  function selectItem(item: ItemWithDistance | null) {
    setSelectedId(item?.id ?? null)
    if (item) {
      const el = itemRefs.current[item.id]
      const list = listRef.current
      if (el && list) {
        list.scrollTo({ top: el.offsetTop - list.offsetTop - 8, behavior: 'smooth' })
      }
    }
  }

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border border-[#E5E7EB] shadow-sm"
      style={{ height: 'calc(100vh - 300px)', minHeight: 480 }}
    >
      <div className="flex h-full">

        {/* ── Left panel (desktop only) ─────────────────────────────────── */}
        <div
          ref={listRef}
          className="hidden lg:flex flex-col w-[300px] shrink-0 border-r border-[#E5E7EB] overflow-y-auto bg-white"
        >
          <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-[#F3F4F6] px-3 py-2.5 z-10">
            <span className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              {mapped.length} location{mapped.length !== 1 ? 's' : ''}
              {items.length > mapped.length && (
                <span className="font-normal"> · {items.length - mapped.length} no coords</span>
              )}
            </span>
          </div>
          {mapped.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-[13px] text-[#9CA3AF] text-center">No items with location data</p>
            </div>
          ) : (
            mapped.map(item => (
              <MapListItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                hovered={hoveredId === item.id}
                onSelect={selectItem}
                onHover={setHoveredId}
                itemRef={el => { itemRefs.current[item.id] = el }}
              />
            ))
          )}
        </div>

        {/* ── Map ──────────────────────────────────────────────────────────── */}
        <div className="relative flex-1 min-w-0">
          <MapContainer
            center={[UC_DAVIS_LAT, UC_DAVIS_LNG]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ZoomControl position="topright" />
            <MapClickClear onClear={() => setSelectedId(null)} />
            <FlyToSelected item={selectedItem} />
            <ClusterLayer
              items={mapped}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectItem}
              onMapHover={setHoveredId}
            />
          </MapContainer>

          {/* Mobile count badge */}
          <div className="absolute top-3 left-3 z-[1000] lg:hidden bg-white/95 backdrop-blur-sm border border-[#E5E7EB] rounded-xl px-3 py-1.5 shadow-sm pointer-events-none">
            <span className="text-[12px] font-medium text-[#374151]">
              {mapped.length} on map
              {items.length > mapped.length && (
                <span className="text-[#9CA3AF]"> · {items.length - mapped.length} no location</span>
              )}
            </span>
          </div>

          {/* Selected item card */}
          {selectedItem && (
            <SelectedCard item={selectedItem} onClose={() => setSelectedId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}
