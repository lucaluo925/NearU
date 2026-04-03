import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import SubmitForm from './SubmitForm'

export const metadata: Metadata = {
  title: 'Submit a Listing — NearU',
  description: 'Submit an event, place, or activity around UC Davis',
}

export default function SubmitPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header showBack backHref="/" backLabel="Home" title="Submit" />

      <main className="flex-1 max-w-[600px] mx-auto w-full px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-[28px] font-bold tracking-tight text-[#111111] mb-2">
            Submit a Listing
          </h1>
          <p className="text-[14px] text-[#6B7280] leading-relaxed">
            Share an event, food spot, study location, or anything worth discovering around UC Davis.
          </p>
        </div>

        <div className="animate-fade-up animate-fade-up-delay-1">
          <SubmitForm />
        </div>
      </main>
      <Footer />
    </div>
  )
}
