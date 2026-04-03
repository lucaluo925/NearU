import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { ToastProvider } from '@/components/Toast'
import { Analytics } from '@vercel/analytics/next'
import ThemeApplicator from '@/components/ThemeApplicator'
import ReferralTracker from '@/components/ReferralTracker'
import PetWidget from '@/components/PetWidget'

export const metadata: Metadata = {
  title: 'NearU — Your campus. Your city.',
  description: 'NearU — discover events, food, study spots, outdoor trails, and more around UC Davis and Davis, CA.',
  openGraph: {
    title: 'NearU — Your campus. Your city.',
    description: 'Discover events, food, study spots, and more around UC Davis. Your campus discovery app.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#FAFAFA] text-[#111111]">
        <ToastProvider>
          <ThemeApplicator />
          <Suspense fallback={null}><ReferralTracker /></Suspense>
          {children}
          <PetWidget />
        </ToastProvider>
        <Analytics />
      </body>
    </html>
  )
}
