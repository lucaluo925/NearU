import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowRight, Search, Calendar } from 'lucide-react'
import { CATEGORIES } from '@/lib/constants'
import { getServerSupabase } from '@/lib/supabase-server'
import CategoryCard from '@/components/CategoryCard'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import NoticeToast from '@/components/NoticeToast'
import PopularSections from '@/components/PopularSection'
import TopRatedSection from '@/components/TopRatedSection'
import NearCampusSection from '@/components/NearCampusSection'
import HomePersonalization from '@/components/HomePersonalization'
import EventsTimeline from '@/components/EventsTimeline'
import ShareButton from '@/components/ShareButton'
import RewardsCue from '@/components/RewardsCue'
import { SkeletonTimeline } from '@/components/SkeletonCard'
import FeedbackCue from '@/components/FeedbackCue'

// ── Live event count ──────────────────────────────────────────────────────────

async function getWeekEventCount(): Promise<number> {
  try {
    const supabase = getServerSupabase()
    const now = new Date().toISOString()
    const eow = new Date(); eow.setDate(eow.getDate() + 7)
    const { count } = await supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('category', 'events')
      .eq('status', 'approved')
      .is('deleted_at', null)
      .gte('start_time', now)
      .lte('start_time', eow.toISOString())
    return count ?? 0
  } catch {
    return 0
  }
}

async function EventCountBadge() {
  const count = await getWeekEventCount()
  if (count === 0) return null
  const display = count >= 50 ? `${Math.floor(count / 10) * 10}+` : `${count}`
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
      <Calendar className="w-3 h-3" />
      {display} events this week
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <Suspense fallback={null}><NoticeToast /></Suspense>

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 pt-6 pb-8">

        {/* ── Compact brand + search + filters ─────────────────────────────── */}
        <section className="mb-7 animate-fade-up">
          {/* Brand line */}
          <div className="flex items-baseline gap-2 mb-0.5">
            <h1 className="text-[26px] font-bold tracking-tight text-[#111111]">NearU</h1>
            <span className="text-[14px] text-[#9CA3AF] font-normal">Your campus. Your city.</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[12px] text-[#C4C9D4]">Find events, food, and spots — tailored to you.</p>
            <Suspense fallback={null}>
              <EventCountBadge />
            </Suspense>
          </div>

          {/* Search + Share */}
          <div className="flex items-center gap-2 mb-3">
            <Link href="/search"
              className="flex items-center gap-3 flex-1 max-w-[480px] bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 shadow-sm hover:shadow-md hover:border-[#D1D5DB] transition-all group">
              <Search className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors" />
              <span className="text-[14px] text-[#9CA3AF]">Search events, places, food...</span>
              <span className="ml-auto text-[12px] text-[#C4C9D4] hidden sm:block">⌘K</span>
            </Link>
            <ShareButton />
          </div>

          {/* Quick filters — horizontal scroll, never wraps */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5 -mx-6 px-6">
            {[
              { label: '📅 Today',            href: '/search?time=today' },
              { label: '🌙 Tonight',           href: '/search?category=events&time=today' },
              { label: '🆓 Free',              href: '/search?tag=free' },
              { label: '🌿 Outdoor',           href: '/search?tag=outdoor' },
              { label: '🎓 Student-Friendly',  href: '/search?tag=student-friendly' },
            ].map((f) => (
              <Link key={f.href} href={f.href}
                className="flex-none text-[13px] font-medium rounded-full px-3.5 py-1.5 bg-white border border-[#E5E7EB] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB] hover:shadow-sm transition-all whitespace-nowrap">
                {f.label}
              </Link>
            ))}
          </div>

          {/* Rewards cue — visible to all, personalised for logged-in users */}
          <RewardsCue />
        </section>

        {/* ── 🔥 For You — personalized, pet-guided, above the fold ─────────── */}
        <HomePersonalization />

        {/* ── 📈 Trending Now — always-filled fallback below For You ──────── */}
        <Suspense fallback={null}>
          <PopularSections />
        </Suspense>

        {/* ── 📅 Upcoming Events — time-based, below fold ─────────────────── */}
        <Suspense fallback={<SkeletonTimeline />}>
          <EventsTimeline />
        </Suspense>

        {/* ── ⭐ Top Rated Food ─────────────────────────────────────────────── */}
        <Suspense fallback={null}>
          <TopRatedSection />
        </Suspense>

        {/* ── 📍 Near Campus ───────────────────────────────────────────────── */}
        <Suspense fallback={null}>
          <NearCampusSection />
        </Suspense>

        {/* ── Browse by Category ─────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest mb-5">
            Browse by Category
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CATEGORIES.map((category, i) => (
              <CategoryCard key={category.slug} category={category} index={i} />
            ))}
          </div>
        </section>

        {/* ── Submit CTA ─────────────────────────────────────────────────── */}
        <section className="animate-fade-up">
          <div className="relative bg-[#111111] rounded-3xl p-8 sm:p-10 overflow-hidden">
            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
              <div>
                <h3 className="text-[20px] font-bold text-white mb-1">Know something worth sharing?</h3>
                <p className="text-[14px] text-white/60">
                  Submit an event, place, or spot. Upload a flyer — AI fills the rest.
                </p>
              </div>
              <Link href="/submit"
                className="flex items-center gap-2 text-[14px] font-semibold bg-white text-[#111111] px-5 py-3 rounded-2xl hover:bg-[#F3F4F6] transition-colors whitespace-nowrap shrink-0">
                Submit a Listing
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/[0.03] rounded-full -translate-y-1/3 translate-x-1/3 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/[0.03] rounded-full translate-y-1/2 -translate-x-1/4 pointer-events-none" />
          </div>
        </section>

        {/* ── Feedback entry point ────────────────────────────────────────── */}
        <div className="flex justify-center pt-2 pb-4">
          <FeedbackCue />
        </div>

      </main>
      <Footer />
    </div>
  )
}
