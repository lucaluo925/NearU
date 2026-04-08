import type { Metadata } from 'next'
import Link from 'next/link'
import LoginClient from './LoginClient'

export const metadata: Metadata = {
  title: 'Sign In — NearU',
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center px-6 py-16">
      {/* Logo */}
      <Link href="/" className="text-[22px] font-bold tracking-tight text-[#111111] mb-10">
        NearU
      </Link>

      {/* Card */}
      <div className="w-full max-w-[380px] bg-white border border-[#E5E7EB] rounded-3xl shadow-sm p-8">
        <LoginClient />
      </div>

      <p className="mt-6 text-[12px] text-[#9CA3AF]">
        <Link href="/" className="hover:text-[#6B7280] transition-colors">← Back to NearU</Link>
      </p>
    </div>
  )
}
