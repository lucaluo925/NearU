interface EmptyStateProps {
  title?:       string
  description?: string
  action?:      React.ReactNode
  icon?:        string
  compact?:     boolean
}

export default function EmptyState({
  title       = 'Nothing here yet',
  description = 'Try adjusting your filters or search, or check back later.',
  action,
  icon        = '🔍',
  compact     = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 text-center ${
        compact ? 'py-12' : 'py-20'
      }`}
    >
      <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mb-4 text-2xl select-none">
        {icon}
      </div>
      <h3 className="text-[16px] font-semibold text-[#111111] mb-2">{title}</h3>
      <p className="text-[14px] text-[#6B7280] max-w-[320px] leading-relaxed">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

// ── Preset variants ───────────────────────────────────────────────────────────

export function NoEventsState({ action }: { action?: React.ReactNode }) {
  return (
    <EmptyState
      icon="📅"
      title="No events found"
      description="There are no events matching your filters right now. Try changing the date range or clearing some filters."
      action={action}
    />
  )
}

export function NoResultsState({ action }: { action?: React.ReactNode }) {
  return (
    <EmptyState
      icon="🔍"
      title="No results found"
      description="Try different search terms, remove a filter, or browse a different category."
      action={action}
    />
  )
}

export function NoListingsState({ action }: { action?: React.ReactNode }) {
  return (
    <EmptyState
      icon="✨"
      title="Nothing here yet"
      description="Be the first to add something — submit an event, place, or activity."
      action={action}
    />
  )
}
