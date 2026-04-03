'use client'

import { useState, useEffect } from 'react'
import { Users, UserPlus, FileText, CheckCircle, Clock, Flag, XCircle, List, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminMetrics } from '@/app/api/admin/metrics/route'

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: number | string
  sub?: string
  color?: string
}

function MetricCard({ icon, label, value, sub, color = 'text-[#111111]' }: MetricCardProps) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
        <span className="w-8 h-8 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]">
          {icon}
        </span>
      </div>
      <div>
        <p className={cn('text-[32px] font-bold leading-none', color)}>{value}</p>
        {sub && <p className="text-[12px] text-[#9CA3AF] mt-1">{sub}</p>}
      </div>
    </div>
  )
}

function SubmissionBreakdown({ data }: { data: AdminMetrics['submissions'] }) {
  const items = [
    { label: 'Approved', value: data.approved, color: 'bg-emerald-500' },
    { label: 'Pending',  value: data.pending,  color: 'bg-amber-400' },
    { label: 'Flagged',  value: data.flagged,  color: 'bg-orange-500' },
    { label: 'Rejected', value: data.rejected, color: 'bg-red-400' },
  ]
  const total = data.total || 1

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
      <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wide mb-4">
        Submission Breakdown
      </p>
      {/* Stacked bar */}
      <div className="flex rounded-full overflow-hidden h-2.5 mb-4 bg-[#F3F4F6]">
        {items.map(({ label, value, color }) => (
          <div
            key={label}
            className={cn('h-full transition-all', color)}
            style={{ width: `${Math.round((value / total) * 100)}%` }}
            title={`${label}: ${value}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-2">
            <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', color)} />
            <span className="text-[12px] text-[#6B7280]">{label}</span>
            <span className="text-[12px] font-semibold text-[#374151] ml-auto">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminMetrics() {
  const [data, setData] = useState<AdminMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/metrics')
      if (res.ok) {
        setData(await res.json())
        setLastUpdated(new Date())
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl skeleton" />
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#374151]">Platform Overview</h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] text-[#374151] px-3 py-1.5 rounded-full hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* User metrics */}
      <div>
        <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-3">Users</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            icon={<Users className="w-4 h-4" />}
            label="Total Users"
            value={data.users.total}
            sub="registered accounts"
          />
          <MetricCard
            icon={<UserPlus className="w-4 h-4" />}
            label="New This Week"
            value={data.users.new_this_week}
            sub="signed up last 7 days"
            color={data.users.new_this_week > 0 ? 'text-emerald-600' : 'text-[#111111]'}
          />
          <MetricCard
            icon={<List className="w-4 h-4" />}
            label="Live Listings"
            value={data.listings.total}
            sub="publicly visible"
          />
        </div>
      </div>

      {/* Content metrics */}
      <div>
        <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-3">Content</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<FileText className="w-4 h-4" />}
            label="Submissions"
            value={data.submissions.total}
            sub="all time"
          />
          <MetricCard
            icon={<CheckCircle className="w-4 h-4" />}
            label="Approved"
            value={data.submissions.approved}
            color="text-emerald-600"
          />
          <MetricCard
            icon={<Clock className="w-4 h-4" />}
            label="Pending"
            value={data.submissions.pending}
            color={data.submissions.pending > 0 ? 'text-amber-600' : 'text-[#111111]'}
          />
          <MetricCard
            icon={<Flag className="w-4 h-4" />}
            label="Flagged"
            value={data.submissions.flagged}
            color={data.submissions.flagged > 0 ? 'text-orange-600' : 'text-[#111111]'}
          />
        </div>

        <div className="mt-4">
          <SubmissionBreakdown data={data.submissions} />
        </div>
      </div>

      {lastUpdated && (
        <p className="text-[11px] text-[#C4C9D4] text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}
