import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mb-5 text-3xl">
        🗺️
      </div>
      <h1 className="text-[28px] font-bold text-[#111111] mb-2">Page not found</h1>
      <p className="text-[15px] text-[#6B7280] max-w-[320px] mb-8 leading-relaxed">
        This page doesn't exist or may have been moved.
      </p>
      <Link
        href="/"
        className="text-[14px] font-semibold bg-[#111111] text-white px-5 py-2.5 rounded-full hover:bg-[#333] transition-colors"
      >
        Back to Homepage
      </Link>
    </div>
  )
}
