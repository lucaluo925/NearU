'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IngestionLog } from '@/app/api/admin/ingestion/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IngestionLog['status'] }) {
  const map = {
    success: { label: 'Success', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle },
    partial: { label: 'Partial',  cls: 'bg-amber-50  text-amber-700  border-amber-200',   Icon: AlertTriangle },
    failed:  { label: 'Failed',   cls: 'bg-red-50    text-red-700    border-red-200',     Icon: XCircle },
  }
  const { label, cls, Icon } = map[status] ?? map.failed
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5', cls)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ logs }: { logs: IngestionLog[] }) {
  // Pick the most recent log per source for summary
  const sources = Array.from(new Set(logs.map((l) => l.source)))
  const latestPerSource = sources.map((src) => logs.find((l) => l.source === src)!)

  const lastRun = logs.length > 0 ? logs[0].run_at : null
  const totalInserted = latestPerSource.reduce((s, l) => s + l.inserted_count, 0)
  const totalUpdated  = latestPerSource.reduce((s, l) => s + l.updated_count, 0)
  const overallStatus = latestPerSource.every((l) => l.status === 'success')
    ? 'success'
    : latestPerSource.some((l) => l.status === 'failed')
    ? 'failed'
    : 'partial'

  const statusColor = {
    success: 'text-emerald-600',
    partial: 'text-amber-600',
    failed:  'text-red-600',
  }

  const cards = [
    {
      label: 'Last Run',
      value: lastRun ? timeAgo(lastRun) : '—',
      sub:   lastRun ? fmtDate(lastRun) : 'No runs recorded',
    },
    {
      label: 'Last Status',
      value: logs.length > 0 ? overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1) : '—',
      valueClass: logs.length > 0 ? statusColor[overallStatus] : undefined,
      sub: logs.length > 0 ? `${sources.length} source${sources.length !== 1 ? 's' : ''}` : undefined,
    },
    {
      label: 'Inserted (last run)',
      value: logs.length > 0 ? totalInserted.toLocaleString() : '—',
      sub:   'New rows added',
    },
    {
      label: 'Updated (last run)',
      value: logs.length > 0 ? totalUpdated.toLocaleString() : '—',
      sub:   'Existing rows refreshed',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
      {cards.map(({ label, value, valueClass, sub }) => (
        <div key={label} className="bg-white border border-[#E5E7EB] rounded-2xl px-4 py-4 shadow-sm">
          <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-1">{label}</p>
          <p className={cn('text-[22px] font-bold text-[#111111] leading-none mb-1', valueClass)}>{value}</p>
          {sub && <p className="text-[11px] text-[#9CA3AF]">{sub}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Run history table ─────────────────────────────────────────────────────────

function RunTable({ logs }: { logs: IngestionLog[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (logs.length === 0) {
    return (
      <div className="text-center py-16 text-[#9CA3AF] text-[14px]">
        No ingestion runs recorded yet.
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[#F3F4F6] bg-[#F9FAFB]">
            {['Run At', 'Source', 'Inserted', 'Updated', 'Skipped', 'Failed', 'Status'].map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <>
              <tr
                key={log.id}
                className={cn(
                  'border-b border-[#F9FAFB] last:border-0 transition-colors',
                  log.error_message ? 'cursor-pointer hover:bg-[#FFFBEB]' : 'hover:bg-[#F9FAFB]',
                )}
                onClick={() => log.error_message && setExpanded((p) => (p === log.id ? null : log.id))}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-[#374151] font-medium">{fmtDate(log.run_at)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] bg-[#F3F4F6] text-[#374151] rounded-md px-1.5 py-0.5">
                    {log.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-emerald-700 font-semibold">{log.inserted_count}</td>
                <td className="px-4 py-3 text-blue-700 font-semibold">{log.updated_count}</td>
                <td className="px-4 py-3 text-[#9CA3AF]">{log.skipped_count}</td>
                <td className="px-4 py-3 text-red-600 font-semibold">{log.failed_count > 0 ? log.failed_count : <span className="text-[#9CA3AF] font-normal">0</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={log.status} />
                    {log.error_message && (
                      <ChevronDown className={cn('w-3.5 h-3.5 text-[#C4C9D4] transition-transform', expanded === log.id && 'rotate-180')} />
                    )}
                  </div>
                </td>
              </tr>
              {expanded === log.id && log.error_message && (
                <tr key={`${log.id}-err`} className="bg-red-50">
                  <td colSpan={7} className="px-4 py-3">
                    <p className="text-[12px] text-red-700 font-mono leading-relaxed break-all">
                      {log.error_message}
                    </p>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000

export default function AdminIngestion() {
  const [logs, setLogs]       = useState<IngestionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ingestion')
      if (res.ok) {
        const data = await res.json()
        setLogs(Array.isArray(data) ? data : [])
        setLastFetch(new Date())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + auto-refresh
  useEffect(() => {
    loadLogs()

    const tick = () => {
      loadLogs()
      timerRef.current = setTimeout(tick, REFRESH_INTERVAL_MS)
    }
    timerRef.current = setTimeout(tick, REFRESH_INTERVAL_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [loadLogs])

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-bold text-[#111111]">Ingestion Monitor</h2>
          {lastFetch && (
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">
              Updated {timeAgo(lastFetch.toISOString())} · auto-refreshes every 30s
            </p>
          )}
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] text-[#374151] px-3 py-1.5 rounded-full hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
          </div>
          <div className="h-48 rounded-2xl skeleton" />
        </div>
      ) : (
        <>
          <SummaryCards logs={logs} />

          <h3 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-3">
            Recent Runs (last 20)
          </h3>
          <RunTable logs={logs} />
        </>
      )}
    </div>
  )
}
