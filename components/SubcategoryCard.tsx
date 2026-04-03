import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Subcategory } from '@/lib/types'

interface SubcategoryCardProps {
  categorySlug: string
  subcategory: Subcategory
  index: number
}

export default function SubcategoryCard({ categorySlug, subcategory, index }: SubcategoryCardProps) {
  return (
    <Link
      href={`/${categorySlug}/${subcategory.slug}`}
      className={`group flex items-center justify-between bg-white rounded-2xl border border-[#E5E7EB]
        px-5 py-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[#D1D5DB]
        transition-all duration-200 ease-out animate-fade-up`}
      style={{
        animationDelay: `${Math.min(index * 50, 300)}ms`,
        minHeight: '64px',
      }}
    >
      <span className="text-[15px] font-medium text-[#111111]">{subcategory.label}</span>
      <ArrowRight
        className="w-4 h-4 text-[#C4C9D4] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-all duration-200 shrink-0"
      />
    </Link>
  )
}
