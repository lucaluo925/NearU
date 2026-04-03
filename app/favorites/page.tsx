import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import FavoritesClient from './FavoritesClient'

export const metadata: Metadata = {
  title: 'Saved — NearU',
}

export default function FavoritesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header showBack backHref="/" backLabel="Home" title="Saved" />
      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-[28px] font-bold tracking-tight text-[#111111]">Saved</h1>
          <p className="text-[14px] text-[#6B7280] mt-1">Your bookmarked listings.</p>
        </div>
        <FavoritesClient />
      </main>
      <Footer />
    </div>
  )
}
