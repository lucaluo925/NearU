'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Zap, Lock, Check, Clock, Share2, Heart, Star,
  CalendarPlus, Sparkles, Copy, CheckCheck, Users,
} from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { THEMES } from '@/lib/points'
import {
  PET_TYPES, PET_EMOJI, PET_LABEL, PET_PRICES, EGG_PRICE, PET_RARITY, RARITY_LABEL, RARITY_COLORS,
  type PetType,
} from '@/lib/pet'
import { useTheme } from '@/hooks/useTheme'
import { usePoints } from '@/hooks/usePoints'
import { useToast } from '@/components/Toast'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  share_homepage:  <Share2 className="w-3.5 h-3.5" />,
  share_event:     <Share2 className="w-3.5 h-3.5" />,
  save_item:       <Heart className="w-3.5 h-3.5" />,
  add_to_calendar: <CalendarPlus className="w-3.5 h-3.5" />,
  post_review:     <Star className="w-3.5 h-3.5" />,
  referral_signup: <Users className="w-3.5 h-3.5" />,
  buy_egg:         <span className="text-[13px]">🥚</span>,
  hatch_pet:       <span className="text-[13px]">🐾</span>,
  unlock_pet:      <Sparkles className="w-3.5 h-3.5" />,
  unlock_theme:    <Sparkles className="w-3.5 h-3.5" />,
}

// ── Next Unlock banner ────────────────────────────────────────────────────────

function NextUnlockBanner({
  currentPoints, unlockedThemes,
}: { currentPoints: number; unlockedThemes: string[] }) {
  const next = THEMES.filter((t) => t.cost > 0 && !unlockedThemes.includes(t.id))
    .sort((a, b) => a.cost - b.cost)[0]

  if (!next) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 mb-6 flex items-center gap-3">
      <span className="text-xl">🏆</span>
      <p className="text-[13px] font-semibold text-emerald-700">All themes unlocked — you&apos;re a collector.</p>
    </div>
  )

  const ptsNeeded = Math.max(0, next.cost - currentPoints)
  const pct       = Math.min(100, Math.round((currentPoints / next.cost) * 100))

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5 mb-6">
      <div className="flex items-center gap-3 mb-2.5">
        <span className="text-[22px] leading-none">{next.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-amber-800">
            {ptsNeeded === 0
              ? `${next.name} is ready — unlock now ✨`
              : `${ptsNeeded} pts to ${next.name}`}
          </p>
          <p className="text-[11px] text-amber-600">{next.description}</p>
        </div>
        <span className="text-[11px] font-bold text-amber-600 bg-amber-100 rounded-full px-2.5 py-0.5 shrink-0">
          {next.cost} pts
        </span>
      </div>
      <div className="h-[5px] rounded-full bg-amber-200 overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
    </div>
  )
}

// ── Next Pet Unlock banner ────────────────────────────────────────────────────

function NextPetBanner({
  currentPoints, unlockedPets,
}: { currentPoints: number; unlockedPets: string[] }) {
  const next = PET_TYPES.find(
    (t) => PET_PRICES[t as PetType] > 0 && !unlockedPets.includes(t),
  ) as PetType | undefined

  if (!next) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
        <span className="text-xl">🏆</span>
        <p className="text-[13px] font-semibold text-emerald-700">All companions unlocked — you&apos;re a collector.</p>
      </div>
    )
  }

  const price    = PET_PRICES[next]
  const ptsLeft  = Math.max(0, price - currentPoints)
  const pct      = Math.min(100, Math.round((currentPoints / price) * 100))
  const rarity   = PET_RARITY[next]
  const c        = RARITY_COLORS[rarity]
  const emoji    = PET_EMOJI[next]
  const label    = PET_LABEL[next]

  return (
    <div className="border rounded-2xl px-4 py-3.5 mb-4" style={{ backgroundColor: c.bg, borderColor: c.border }}>
      <div className="flex items-center gap-3 mb-2.5">
        <span className="text-[28px] leading-none">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold" style={{ color: c.text }}>
            {ptsLeft === 0
              ? `${label} ${emoji} is ready — unlock now ✨`
              : `You're ${ptsLeft} pts away from ${label} ${emoji}`}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#fff', color: c.text, border: `1px solid ${c.border}` }}
            >
              {RARITY_LABEL[rarity]}
            </span>
            <p className="text-[11px]" style={{ color: c.text, opacity: 0.75 }}>
              {ptsLeft === 0
                ? 'Go unlock your new companion 🎉'
                : 'Keep saving and sharing to unlock your next companion'}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-bold shrink-0 px-2.5 py-0.5 rounded-full" style={{ backgroundColor: '#fff', color: c.text, border: `1px solid ${c.border}` }}>
          {price} pts
        </span>
      </div>
      <div className="h-[5px] rounded-full overflow-hidden" style={{ backgroundColor: `${c.border}` }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(3, pct)}%`, backgroundColor: c.text }}
        />
      </div>
    </div>
  )
}

// ── Egg Shop ──────────────────────────────────────────────────────────────────

interface EggShopSectionProps {
  currentPoints: number
  eggCount: number
  onBuy: () => Promise<void>
}

function EggShopSection({ currentPoints, eggCount, onBuy }: EggShopSectionProps) {
  const [busy, setBusy] = useState(false)
  const canAfford = currentPoints >= EGG_PRICE

  async function handleBuy() {
    if (busy || !canAfford) return
    setBusy(true)
    await onBuy()
    setBusy(false)
  }

  return (
    <section className="mb-10 animate-fade-up">
      <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-4">
        Companion Eggs
      </h2>
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl overflow-hidden">
        {/* Egg card */}
        <div className="p-4 flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white border border-amber-200 flex items-center justify-center shrink-0 shadow-sm">
            <span className="text-[36px] leading-none">🥚</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div>
                <p className="text-[15px] font-bold text-amber-900">Pet Egg</p>
                <p className="text-[12px] text-amber-700 leading-relaxed mt-0.5">
                  A surprise companion, Common to Legendary.
                </p>
              </div>
              <span className="flex items-center gap-1 text-[12px] font-bold text-amber-600 bg-white border border-amber-200 rounded-full px-2.5 py-1 shrink-0">
                <Zap className="w-3 h-3 fill-amber-500 text-amber-500" />
                {EGG_PRICE} pts
              </span>
            </div>

            {/* Rarity hint */}
            <div className="flex items-center gap-1.5 mt-2 mb-3 flex-wrap">
              {(['Common', 'Rare', 'Epic', 'Legendary'] as const).map((r) => {
                const colors = { Common: '#6B7280', Rare: '#3B82F6', Epic: '#8B5CF6', Legendary: '#D97706' }
                return (
                  <span key={r} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#fff', color: colors[r], border: `1px solid ${colors[r]}33` }}>
                    {r}
                  </span>
                )
              })}
            </div>

            <button
              onClick={handleBuy}
              disabled={busy || !canAfford}
              title={!canAfford ? `Need ${EGG_PRICE - currentPoints} more points` : undefined}
              className="w-full text-[13px] font-bold rounded-xl py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600 text-white disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF]"
            >
              {busy
                ? 'Buying…'
                : canAfford
                ? `Buy Egg for ${EGG_PRICE} pts`
                : `Need ${EGG_PRICE - currentPoints} more pts`}
            </button>
          </div>
        </div>

        {/* Egg inventory — shown when user has eggs */}
        {eggCount > 0 && (
          <div className="border-t border-amber-200 px-4 py-3 flex items-center justify-between bg-amber-50/60">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🥚</span>
              <div>
                <p className="text-[12px] font-bold text-amber-800">
                  {eggCount} egg{eggCount > 1 ? 's' : ''} ready to hatch
                </p>
                <p className="text-[11px] text-amber-600">Open your companion from the pet widget</p>
              </div>
            </div>
            <span className="text-[22px] font-black text-amber-500 tabular-nums">{eggCount}</span>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Theme Card ────────────────────────────────────────────────────────────────

interface ThemeCardProps {
  theme: typeof THEMES[number]
  unlocked: boolean
  active: boolean
  currentPoints: number
  onUnlock: (id: string) => Promise<void>
  onSelect: (id: string) => Promise<void>
}

function ThemeCard({ theme, unlocked, active, currentPoints, onUnlock, onSelect }: ThemeCardProps) {
  const [busy, setBusy] = useState(false)
  const canAfford = currentPoints >= theme.cost

  async function handleUnlock() {
    if (busy) return
    setBusy(true)
    await onUnlock(theme.id)
    setBusy(false)
  }

  async function handleSelect() {
    if (busy || active) return
    setBusy(true)
    await onSelect(theme.id)
    setBusy(false)
  }

  return (
    <div className={`relative rounded-2xl border-2 overflow-hidden transition-all ${
      active ? 'border-amber-400 shadow-lg shadow-amber-100' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
    }`}>
      {/* Preview swatch */}
      <div className="h-[80px] flex items-center justify-center relative" style={{ backgroundColor: theme.preview.bg }}>
        <div className="absolute top-0 left-0 right-0 h-[20px] opacity-80" style={{ backgroundColor: theme.preview.bg, borderBottom: `1px solid ${theme.preview.border}` }} />
        <div className="flex items-center gap-2">
          <div className="w-16 h-3 rounded-full opacity-70" style={{ backgroundColor: theme.preview.accent }} />
          <div className="w-8 h-3 rounded-full opacity-40" style={{ backgroundColor: theme.preview.text }} />
        </div>
        <span className="absolute top-1.5 left-3 text-[11px] font-bold" style={{ color: theme.preview.text }}>NearU</span>
        <span className="text-2xl absolute bottom-2 right-3">{theme.emoji}</span>
        {!unlocked && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center backdrop-blur-[1px]">
            <Lock className="w-5 h-5 text-white drop-shadow" />
          </div>
        )}
        {active && (
          <div className="absolute top-1.5 right-2 bg-amber-400 text-white text-[9px] font-bold rounded-full px-2 py-0.5 flex items-center gap-1">
            <Check className="w-2.5 h-2.5" /> Active
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 bg-white">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-[14px] font-bold text-[#111111]">{theme.name}</p>
            <p className="text-[11px] text-[#9CA3AF]">{theme.description}</p>
          </div>
          {theme.cost > 0 && !unlocked && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              <Zap className="w-2.5 h-2.5" />{theme.cost}
            </span>
          )}
          {unlocked && theme.cost > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
              <Check className="w-2.5 h-2.5" /> Unlocked
            </span>
          )}
        </div>

        {active ? (
          <div className="w-full text-center text-[12px] font-semibold text-amber-600 py-1.5">Currently active</div>
        ) : unlocked ? (
          <button onClick={handleSelect} disabled={busy}
            className="w-full text-[13px] font-semibold bg-[#111111] text-white rounded-xl py-2 hover:bg-[#333] transition-colors disabled:opacity-50">
            {busy ? 'Applying…' : 'Apply Theme'}
          </button>
        ) : (
          <button onClick={handleUnlock} disabled={busy || !canAfford}
            title={!canAfford ? `Need ${theme.cost - currentPoints} more points` : undefined}
            className="w-full text-[13px] font-semibold rounded-xl py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 text-white hover:bg-amber-600 disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF]">
            {busy ? 'Unlocking…' : canAfford ? `Unlock for ${theme.cost} pts` : `Need ${theme.cost} pts`}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Referral section ──────────────────────────────────────────────────────────

function ReferralSection() {
  const { show } = useToast()
  const [refUrl, setRefUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/referral')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.share_url) setRefUrl(d.share_url) })
      .catch(() => {})
  }, [])

  async function copyLink() {
    if (!refUrl) return
    try {
      await navigator.clipboard.writeText(refUrl)
      setCopied(true)
      show('Referral link copied!')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      show('Could not copy link', 'error')
    }
  }

  return (
    <section className="mb-10 animate-fade-up">
      <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-4">
        Invite Friends
      </h2>
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-amber-900">Invite a friend → get 30 pts</p>
            <p className="text-[13px] text-amber-700 mt-0.5 leading-relaxed">
              Share your link. When a friend signs up, you get <strong>30 points</strong> instantly.
            </p>
          </div>
        </div>

        {refUrl ? (
          <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl px-3 py-2.5">
            <p className="text-[12px] text-[#374151] font-mono flex-1 min-w-0 truncate">{refUrl}</p>
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-600 hover:text-amber-700 transition-colors shrink-0"
            >
              {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ) : (
          <div className="h-10 rounded-xl bg-amber-100 animate-pulse" />
        )}

        <p className="text-[11px] text-amber-600 mt-2.5">
          Every referral gets you closer to unlocking a theme. {THEMES.filter(t => t.cost > 0).length} to collect.
        </p>
      </div>
    </section>
  )
}

// ── How to earn ───────────────────────────────────────────────────────────────

const HOW_TO_EARN = [
  { emoji: '🔗', label: 'Share NearU',               pts: '+10', note: 'One time' },
  { emoji: '📣', label: 'Share an event',            pts: '+5',  note: 'Up to 3×/day per event' },
  { emoji: '❤️',  label: 'Save a listing',            pts: '+2',  note: 'Up to 10×/day per listing' },
  { emoji: '🗓️', label: 'Add to calendar',           pts: '+3',  note: 'Up to 5×/day per event' },
  { emoji: '⭐', label: 'Post a review',             pts: '+5',  note: '1× per listing' },
  { emoji: '🎉', label: 'Refer a friend',            pts: '+30', note: '1× per person' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RewardsPage() {
  const { show } = useToast()
  const { data: pointsData, loading: pointsLoading } = usePoints()
  const { state: themeState, unlock, select } = useTheme()
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [unlockedPets, setUnlockedPets] = useState<string[]>(['dog'])
  const [eggCount, setEggCount] = useState(0)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedIn(!!session)
      if (session) {
        fetch('/api/pet')
          .then((r) => r.ok ? r.json() : null)
          .then((d) => {
            if (d?.unlocked_pets) setUnlockedPets(d.unlocked_pets)
            if (d?.egg_count != null) setEggCount(d.egg_count)
          })
          .catch(() => {})
      }
    })
  }, [])

  const handleUnlock = useCallback(async (themeId: string) => {
    const result = await unlock(themeId)
    if (result.ok) {
      const theme = THEMES.find((t) => t.id === themeId)
      show(`🎉 ${theme?.name ?? themeId} unlocked!`)
      await select(themeId)
      show(`✨ You're now using ${theme?.name ?? themeId}`)
    } else {
      show(result.error ?? 'Could not unlock theme', 'error')
    }
  }, [unlock, select, show])

  const handleSelect = useCallback(async (themeId: string) => {
    const result = await select(themeId)
    if (result.ok) {
      const theme = THEMES.find((t) => t.id === themeId)
      show(`✨ You're now using ${theme?.name ?? themeId}`)
    } else {
      show('Could not apply theme', 'error')
    }
  }, [select, show])

  const handleBuyEgg = useCallback(async () => {
    try {
      const r = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy_egg' }),
      })
      const data = await r.json()
      if (!r.ok) {
        show(data?.error ?? 'Could not buy egg', 'error')
        return
      }
      const newCount = data.egg_count ?? (eggCount + 1)
      setEggCount(newCount)
      // Optimistically update point balance shown in the header
      if (data.current_points != null) {
        // Trigger a re-fetch of points
        fetch('/api/points').then((res) => res.ok ? res.json() : null).catch(() => null)
      }
      show(`🥚 Pet Egg added to your inventory!`)
    } catch {
      show('Network error — please try again', 'error')
    }
  }, [eggCount, show])

  const currentPoints   = themeState?.current_points ?? pointsData?.current_points ?? 0
  const unlockedThemes  = themeState?.unlocked ?? ['default']
  const activeTheme     = themeState?.active   ?? 'default'

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (loggedIn === false) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header showBack backHref="/" backLabel="Home" />
        <main className="flex-1 max-w-[600px] mx-auto w-full px-6 py-16 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-5">
            <Zap className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-[24px] font-bold text-[#111111] mb-2">Earn Points &amp; Unlock Themes</h1>
          <p className="text-[15px] text-[#6B7280] max-w-[320px] leading-relaxed mb-3">
            Sign in to earn points for saving, sharing, and reviewing.
          </p>
          <p className="text-[13px] text-amber-600 font-semibold mb-8">
            Invite a friend → get 30 pts instantly 🎉
          </p>
          <Link href="/login"
            className="bg-[#111111] text-white text-[15px] font-semibold px-6 py-3 rounded-2xl hover:bg-[#333] transition-colors">
            Sign In to Get Started
          </Link>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header showBack backHref="/" backLabel="Home" />
      <main className="flex-1 max-w-[680px] mx-auto w-full px-6 py-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mb-8 animate-fade-up">
          <div>
            <h1 className="text-[26px] font-bold text-[#111111] tracking-tight">Rewards</h1>
            <p className="text-[13px] text-[#9CA3AF] mt-0.5">Earn points. Unlock themes. Share faster.</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5">
              <Zap className="w-4 h-4 fill-amber-500 text-amber-500" />
              <span className="text-[22px] font-black text-amber-600 tabular-nums">
                {pointsLoading ? '—' : currentPoints}
              </span>
              <span className="text-[12px] text-amber-500 font-medium">pts</span>
            </div>
            {(pointsData?.total_points_earned ?? 0) > 0 && (
              <p className="text-[11px] text-[#9CA3AF]">{pointsData!.total_points_earned} earned total</p>
            )}
          </div>
        </div>

        {/* ── Next Unlock ────────────────────────────────────────────────── */}
        {!pointsLoading && (
          <div className="animate-fade-up">
            <NextPetBanner currentPoints={currentPoints} unlockedPets={unlockedPets} />
            <NextUnlockBanner currentPoints={currentPoints} unlockedThemes={unlockedThemes} />
          </div>
        )}

        {/* ── Egg Shop ───────────────────────────────────────────────────── */}
        {loggedIn && (
          <EggShopSection
            currentPoints={currentPoints}
            eggCount={eggCount}
            onBuy={handleBuyEgg}
          />
        )}

        {/* ── Themes ─────────────────────────────────────────────────────── */}
        <section className="mb-10 animate-fade-up">
          <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-4">Themes</h2>
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                unlocked={theme.cost === 0 || unlockedThemes.includes(theme.id)}
                active={activeTheme === theme.id}
                currentPoints={currentPoints}
                onUnlock={handleUnlock}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </section>

        {/* ── Referral ───────────────────────────────────────────────────── */}
        <ReferralSection />

        {/* ── How to earn ────────────────────────────────────────────────── */}
        <section className="mb-10 animate-fade-up">
          <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-4">How to Earn Points</h2>
          <div className="bg-white border border-[#E5E7EB] rounded-2xl divide-y divide-[#F3F4F6] overflow-hidden shadow-sm">
            {HOW_TO_EARN.map((item) => (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                <span className="text-[18px] w-7 text-center shrink-0">{item.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#374151]">{item.label}</p>
                  <p className="text-[11px] text-[#9CA3AF]">{item.note}</p>
                </div>
                <span className="text-[13px] font-bold text-emerald-600 shrink-0">{item.pts}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Point history ───────────────────────────────────────────────── */}
        <section className="animate-fade-up">
          <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-4">Recent Activity</h2>

          {pointsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-2xl skeleton" />)}
            </div>
          ) : !pointsData?.history.length ? (
            <div className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-8 text-center">
              <p className="text-[13px] text-[#9CA3AF]">Nothing yet.</p>
              <p className="text-[12px] text-[#C4C9D4] mt-1">Save a listing or share NearU to earn your first points.</p>
            </div>
          ) : (
            <div className="bg-white border border-[#E5E7EB] rounded-2xl divide-y divide-[#F3F4F6] overflow-hidden shadow-sm">
              {pointsData.history.map((evt) => {
                const isSpend = evt.points < 0
                const isNeutral = evt.points === 0
                return (
                  <div key={evt.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isSpend ? 'bg-red-50 text-red-400' : isNeutral ? 'bg-[#F3F4F6] text-[#9CA3AF]' : 'bg-amber-50 text-amber-500'}`}>
                      {TYPE_ICON[evt.type] ?? <Sparkles className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#374151]">{evt.label}</p>
                      <p className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
                        <Clock className="w-3 h-3" />
                        {timeAgo(evt.created_at)}
                      </p>
                    </div>
                    {isNeutral ? (
                      <span className="text-[11px] text-[#C4C9D4] shrink-0">—</span>
                    ) : (
                      <span className={`text-[13px] font-bold shrink-0 ${isSpend ? 'text-red-400' : 'text-emerald-600'}`}>
                        {isSpend ? evt.points : `+${evt.points}`}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

      </main>
      <Footer />
    </div>
  )
}
