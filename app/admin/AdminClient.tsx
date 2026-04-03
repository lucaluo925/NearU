'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Trash2, ExternalLink, MapPin, Clock, RefreshCw,
  CheckCircle, XCircle, Flag, AlertTriangle, Shield,
  ChevronDown, LogOut, BarChart2, Users, FileText, Activity,
} from 'lucide-react'
import { Item, ItemStatus } from '@/lib/types'
import { CATEGORIES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import AdminMetrics from './AdminMetrics'
import AdminUsers from './AdminUsers'
import AdminIngestion from './AdminIngestion'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCategoryLabel(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug
}
function getSubLabel(catSlug: string, subSlug: string) {
  const cat = CATEGORIES.find((c) => c.slug === catSlug)
  return cat?.subcategories.find((s) => s.slug === subSlug)?.label ?? subSlug
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: ItemStatus }) {
  if (!status) return null
  const map: Record<ItemStatus, { label: string; cls: string }> = {
    pending:  { label: 'Pending',  cls: 'bg-amber-50  text-amber-700  border-amber-200' },
    approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected: { label: 'Rejected', cls: 'bg-red-50    text-red-700    border-red-200' },
    flagged:  { label: 'Flagged',  cls: 'bg-orange-50 text-orange-700  border-orange-200' },
  }
  const { label, cls } = map[status] ?? map.pending
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5', cls)}>
      {label}
    </span>
  )
}

// ── Risk badge ────────────────────────────────────────────────────────────────

function RiskBadge({ score, reason }: { score?: number | null; reason?: string | null }) {
  if (score == null) return null
  const level = score >= 66 ? 'high' : score >= 31 ? 'medium' : 'safe'
  const map = {
    safe:   { label: `Risk ${score}`, cls: 'bg-emerald-50 text-emerald-600', Icon: Shield },
    medium: { label: `Risk ${score}`, cls: 'bg-amber-50   text-amber-600',   Icon: AlertTriangle },
    high:   { label: `Risk ${score}`, cls: 'bg-red-50     text-red-600',     Icon: Flag },
  }
  const { label, cls, Icon } = map[level]
  return (
    <span
      className={cn('flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5', cls)}
      title={reason ?? undefined}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ── Item card ─────────────────────────────────────────────────────────────────

interface CardProps {
  item: Item
  onAction: (id: string, action: 'approve' | 'reject' | 'flag' | 'delete') => void
  busy: boolean
  expanded: boolean
  onToggle: () => void
}

function ItemCard({ item, onAction, busy, expanded, onToggle }: CardProps) {
  return (
    <div className={cn(
      'bg-white border rounded-2xl shadow-sm transition-shadow hover:shadow-md',
      item.status === 'flagged' ? 'border-orange-200' : 'border-[#E5E7EB]',
    )}>
      <div className="flex gap-4 items-start p-4">
        {item.flyer_image_url && (
          <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-[#F3F4F6]">
            <Image src={item.flyer_image_url} alt={item.title} fill className="object-cover" sizes="56px" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#111111] leading-snug line-clamp-1 flex-1 min-w-0">
              {item.title}
            </h3>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <StatusBadge status={item.status} />
              <RiskBadge score={item.risk_score} reason={item.moderation_reason} />
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[11px] bg-[#F3F4F6] text-[#6B7280] rounded-full px-2 py-0.5">
              {getCategoryLabel(item.category)}
            </span>
            <span className="text-[11px] bg-[#F3F4F6] text-[#6B7280] rounded-full px-2 py-0.5">
              {getSubLabel(item.category, item.subcategory)}
            </span>
            {item.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[11px] text-[#9CA3AF]">#{tag}</span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="line-clamp-1">{item.address}</span>
            </span>
            {item.start_time && (
              <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
                <Clock className="w-3 h-3 shrink-0" />
                {new Date(item.start_time).toLocaleDateString()}
              </span>
            )}
            <span className="text-[11px] text-[#C4C9D4]">
              {new Date(item.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {item.moderation_reason && (
        <button onClick={onToggle} className="w-full flex items-center justify-between px-4 pb-2 text-left">
          <span className="text-[11px] text-[#9CA3AF] italic line-clamp-1">
            AI: {item.moderation_reason}
          </span>
          <ChevronDown className={cn('w-3.5 h-3.5 text-[#C4C9D4] shrink-0 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
      {expanded && item.moderation_reason && (
        <div className="px-4 pb-3">
          <p className="text-[12px] text-[#6B7280] bg-[#F9FAFB] rounded-xl px-3 py-2 leading-relaxed">
            {item.moderation_reason}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 px-4 pb-4 border-t border-[#F3F4F6] pt-3">
        <button onClick={() => onAction(item.id, 'approve')} disabled={busy || item.status === 'approved'}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <CheckCircle className="w-3.5 h-3.5" /> Approve
        </button>
        <button onClick={() => onAction(item.id, 'reject')} disabled={busy || item.status === 'rejected'}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <XCircle className="w-3.5 h-3.5" /> Reject
        </button>
        <button onClick={() => onAction(item.id, 'flag')} disabled={busy || item.status === 'flagged'}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-full hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <Flag className="w-3.5 h-3.5" /> Flag
        </button>
        <div className="flex-1" />
        {item.external_link && (
          <a href={item.external_link} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button onClick={() => onAction(item.id, 'delete')} disabled={busy}
          className="p-1.5 text-[#9CA3AF] hover:text-red-500 disabled:opacity-50 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Content tab (submissions) ─────────────────────────────────────────────────

type ContentTab = 'pending' | 'flagged' | 'all'

const CONTENT_TABS: { id: ContentTab; label: string; color: string }[] = [
  { id: 'pending', label: 'Pending', color: 'text-amber-600' },
  { id: 'flagged', label: 'Flagged', color: 'text-red-600' },
  { id: 'all',     label: 'All',     color: 'text-[#374151]' },
]

function ContentPanel() {
  const [items, setItems]       = useState<Item[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<ContentTab>('pending')
  const [busy, setBusy]         = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadItems = useCallback(async (t: ContentTab = tab) => {
    setLoading(true)
    try {
      const url = t === 'all' ? '/api/admin/items' : `/api/admin/items?status=${t}`
      const res = await fetch(url)
      if (res.ok) setItems(await res.json())
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { loadItems(tab) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction(id: string, action: 'approve' | 'reject' | 'flag' | 'delete') {
    if (action === 'delete' && !confirm('Permanently delete this listing?')) return
    setBusy(id)
    try {
      if (action === 'delete') {
        await fetch(`/api/admin/items/${id}`, { method: 'DELETE' })
        setItems((prev) => prev.filter((x) => x.id !== id))
      } else {
        const statusMap = { approve: 'approved', reject: 'rejected', flag: 'flagged' } as const
        const res = await fetch(`/api/admin/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: statusMap[action] }),
        })
        if (res.ok) {
          const updated = await res.json()
          setItems((prev) => prev.map((x) => x.id === id ? { ...x, ...updated } : x))
          if (tab !== 'all') {
            setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id || x.status === tab)), 600)
          }
        }
      }
    } finally {
      setBusy(null)
    }
  }

  const counts = {
    pending: items.filter((i) => i.status === 'pending').length,
    flagged: items.filter((i) => i.status === 'flagged').length,
    all: items.length,
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-[#F3F4F6]">
        {CONTENT_TABS.map(({ id, label, color }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
              tab === id ? 'border-[#111111] text-[#111111]' : 'border-transparent text-[#9CA3AF] hover:text-[#6B7280]'
            )}
          >
            {label}
            {tab === id && counts[id] > 0 && (
              <span className={cn('ml-1.5 text-[11px]', color)}>({counts[id]})</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => loadItems(tab)} disabled={loading}
          className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] text-[#374151] px-3 py-1.5 rounded-full hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors mb-1">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <p className="text-[13px] text-[#6B7280] mb-4">{loading ? 'Loading…' : `${items.length} item${items.length !== 1 ? 's' : ''}`}</p>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-[#9CA3AF] text-[14px]">
          {tab === 'pending' ? 'No items awaiting review.' : tab === 'flagged' ? 'No flagged items.' : 'No items found.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onAction={handleAction}
              busy={busy === item.id}
              expanded={expanded === item.id}
              onToggle={() => setExpanded((prev) => prev === item.id ? null : item.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Top-level tab navigation ──────────────────────────────────────────────────

type TopTab = 'overview' | 'content' | 'users' | 'ingestion'

const TOP_TABS: { id: TopTab; label: string; Icon: React.ElementType }[] = [
  { id: 'overview',  label: 'Overview',  Icon: BarChart2 },
  { id: 'content',   label: 'Content',   Icon: FileText },
  { id: 'users',     label: 'Users',     Icon: Users },
  { id: 'ingestion', label: 'Ingestion', Icon: Activity },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminClient({ authorizedEmail }: { authorizedEmail: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<TopTab>('overview')

  // Client-side guard — last resort if server-side checks are bypassed
  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = (session?.user?.email ?? '').toLowerCase().trim()
      if (!email || email !== authorizedEmail.toLowerCase().trim()) {
        router.replace('/?notice=unauthorized')
      }
    })
  }, [authorizedEmail, router])

  async function handleSignOut() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div>
      {/* Top navigation */}
      <div className="flex items-center gap-1 mb-8 border-b border-[#E5E7EB] pb-0">
        {TOP_TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-[#111111] text-[#111111]'
                : 'border-transparent text-[#9CA3AF] hover:text-[#374151]'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-[12px] font-medium text-[#9CA3AF] hover:text-red-500 px-3 py-1.5 rounded-full hover:bg-red-50 transition-all mb-0.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>

      {/* Panels */}
      {tab === 'overview'  && <AdminMetrics />}
      {tab === 'content'   && <ContentPanel />}
      {tab === 'users'     && <AdminUsers />}
      {tab === 'ingestion' && <AdminIngestion />}
    </div>
  )
}
