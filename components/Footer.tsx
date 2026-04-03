import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-[#E5E7EB] py-6 mt-8">
      <div className="max-w-[1100px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3">
          <span className="text-[13px] font-semibold text-[#111111]">NearU</span>
          <span className="hidden sm:block text-[#D1D5DB]">·</span>
          <span className="text-[12px] text-[#9CA3AF]">
            Built by{' '}
            <a
              href="https://github.com/lucaluo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6B7280] hover:text-[#111111] transition-colors font-medium"
            >
              Luca Luo
            </a>
          </span>
          <span className="hidden sm:block text-[#D1D5DB]">·</span>
          <span className="text-[12px] text-[#C4C9D4]">UC Davis student project</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/favorites" className="text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">Saved</Link>
          <Link href="/submit" className="text-[12px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">Submit</Link>
          <Link href="/admin" className="text-[12px] text-[#C4C9D4] hover:text-[#9CA3AF] transition-colors">Admin</Link>
        </div>
      </div>
    </footer>
  )
}
