'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Shield, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminUser } from '@/app/api/admin/users/route'

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
        <Shield className="w-3 h-3" /> Admin
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] rounded-full px-2 py-0.5">
      <User className="w-3 h-3" /> User
    </span>
  )
}

export default function AdminUsers() {
  const [users, setUsers]     = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setUsers(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px] font-semibold text-[#374151]">
          Registered Users
          {!loading && (
            <span className="ml-2 text-[12px] font-normal text-[#9CA3AF]">
              {users.length} total
            </span>
          )}
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] text-[#374151] px-3 py-1.5 rounded-full hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl skeleton" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-10 text-[14px] text-red-500">{error}</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[14px] text-[#9CA3AF] mb-2">No registered users yet.</p>
          <p className="text-[12px] text-[#C4C9D4]">
            Run the SQL migration (<code className="bg-[#F3F4F6] px-1.5 py-0.5 rounded">002_add_profiles.sql</code>) if you haven&apos;t already.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
            <span>User</span>
            <span className="hidden sm:block text-right">Role</span>
            <span className="hidden md:block text-right">Submissions</span>
            <span className="hidden lg:block text-right">Last Active</span>
            <span className="text-right">Joined</span>
          </div>

          {/* Rows */}
          {users.map((user, idx) => (
            <div
              key={user.id}
              className={cn(
                'grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 items-center',
                idx !== users.length - 1 && 'border-b border-[#F3F4F6]',
                'hover:bg-[#F9FAFB] transition-colors'
              )}
            >
              {/* User info */}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#111111] truncate">
                  {user.display_name || <span className="text-[#9CA3AF] font-normal">Unnamed</span>}
                </p>
                <p className="text-[11px] text-[#9CA3AF] truncate">{user.email}</p>
              </div>

              {/* Role */}
              <div className="hidden sm:flex justify-end">
                <RoleBadge role={user.role} />
              </div>

              {/* Submissions */}
              <div className="hidden md:block text-right">
                <span className="text-[13px] text-[#374151]">{user.submission_count}</span>
              </div>

              {/* Last active */}
              <div className="hidden lg:block text-right">
                <span className="text-[12px] text-[#9CA3AF]">{timeAgo(user.last_seen_at)}</span>
              </div>

              {/* Joined */}
              <div className="text-right">
                <span className="text-[12px] text-[#9CA3AF]">{timeAgo(user.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
