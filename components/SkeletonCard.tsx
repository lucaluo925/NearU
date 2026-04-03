// ── Skeleton primitives ───────────────────────────────────────────────────────

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#F3F4F6] rounded-xl ${className}`} />
}

// ── Grid card skeleton ────────────────────────────────────────────────────────

export function SkeletonItemCard() {
  return (
    <div className="bg-white rounded-[22px] border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Image area */}
      <div className="h-[168px] animate-pulse bg-gradient-to-br from-[#F3F4F6] to-[#ECEDEF]" />
      <div className="p-4 flex flex-col gap-2.5">
        {/* Title */}
        <Pulse className="h-4 w-3/4" />
        {/* Description lines */}
        <Pulse className="h-3 w-full" />
        <Pulse className="h-3 w-2/3" />
        {/* Tags */}
        <div className="flex gap-1.5 mt-1">
          <Pulse className="h-5 w-14 rounded-full" />
          <Pulse className="h-5 w-20 rounded-full" />
          <Pulse className="h-5 w-12 rounded-full" />
        </div>
        {/* Location */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <Pulse className="h-3 w-3 rounded-full" />
          <Pulse className="h-3 w-24" />
        </div>
        {/* Actions */}
        <div className="flex gap-2 mt-2 pt-2 border-t border-[#F3F4F6]">
          <Pulse className="h-8 flex-1 rounded-xl" />
          <Pulse className="h-8 w-[72px] rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ── List card skeleton ────────────────────────────────────────────────────────

export function SkeletonListCard() {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden flex">
      <div className="w-[84px] sm:w-[88px] shrink-0 animate-pulse bg-gradient-to-br from-[#F3F4F6] to-[#ECEDEF]" />
      <div className="flex-1 p-3 flex flex-col gap-2 justify-center">
        <Pulse className="h-4 w-3/4" />
        <Pulse className="h-3 w-full" />
        <div className="flex gap-1.5">
          <Pulse className="h-4 w-12 rounded-full" />
          <Pulse className="h-4 w-16 rounded-full" />
        </div>
        <Pulse className="h-3 w-1/2" />
      </div>
      <div className="flex flex-col gap-2 items-center justify-center pr-3 py-3 shrink-0">
        <Pulse className="h-7 w-20 rounded-xl" />
        <div className="flex gap-1.5">
          <Pulse className="h-7 w-8 rounded-xl" />
          <Pulse className="h-7 w-8 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ── Mini card skeleton (for horizontal scroll rows) ───────────────────────────

export function SkeletonMiniCard() {
  return (
    <div className="flex-none w-[200px] sm:w-[220px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      <div className="h-[108px] animate-pulse bg-gradient-to-br from-[#F3F4F6] to-[#ECEDEF]" />
      <div className="p-3 flex flex-col gap-2">
        <Pulse className="h-4 w-3/4" />
        <Pulse className="h-3 w-1/2" />
        <Pulse className="h-3 w-2/3" />
      </div>
    </div>
  )
}

// ── Timeline skeleton (for EventsTimeline loading state) ──────────────────────

export function SkeletonTimeline() {
  return (
    <div className="mb-12 flex flex-col gap-8">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pulse className="h-5 w-5 rounded-lg" />
              <Pulse className="h-5 w-24" />
            </div>
            <Pulse className="h-4 w-20" />
          </div>
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3].map((j) => <SkeletonMiniCard key={j} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Subcategory card skeleton ─────────────────────────────────────────────────

export function SkeletonSubcategoryCard() {
  return (
    <div
      className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm px-5 py-4 flex items-center justify-between"
      style={{ minHeight: '64px' }}
    >
      <Pulse className="h-4 w-32" />
      <Pulse className="h-4 w-4 rounded-md" />
    </div>
  )
}
