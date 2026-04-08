import { Suspense } from 'react'
import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import SearchClient from './SearchClient'
import { SkeletonItemCard } from '@/components/SkeletonCard'

export const metadata: Metadata = {
  title: 'Search — NearU',
  description: 'Search events, places, and activities around UC Davis',
}

export default function SearchPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header showBack backHref="/" backLabel="Home" title="Search" />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-[28px] font-bold tracking-tight text-[#111111]">Search</h1>
          <p className="text-[14px] text-[#6B7280] mt-1">
            Find events, food, study spots, and more.
          </p>
        </div>

        <Suspense fallback={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonItemCard key={i} />)}
          </div>
        }>
          <SearchClient />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
