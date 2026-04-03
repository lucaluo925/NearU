import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Category } from '@/lib/types'

interface CategoryCardProps {
  category: Category
  index: number
}

export default function CategoryCard({ category, index }: CategoryCardProps) {
  return (
    <Link
      href={`/${category.slug}`}
      className={`group block bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-sm
        hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ease-out
        animate-fade-up animate-fade-up-delay-${Math.min(index + 1, 6)}`}
      style={{ minHeight: '120px' }}
    >
      <div className="flex items-start justify-between h-full">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none" role="img" aria-hidden>
              {category.icon}
            </span>
            <h2 className="text-[17px] font-semibold text-[#111111]">
              {category.label}
            </h2>
          </div>
          <p className="text-[13px] text-[#6B7280] leading-relaxed max-w-[220px]">
            {category.subtitle}
          </p>
          <p className="text-[12px] text-[#9CA3AF] mt-1">
            {category.subcategories.length} subcategories
          </p>
        </div>
        <ArrowRight
          className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-all duration-200 mt-0.5 shrink-0"
        />
      </div>
    </Link>
  )
}
