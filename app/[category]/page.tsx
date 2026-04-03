import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Header from '@/components/Header'
import SubcategoryCard from '@/components/SubcategoryCard'
import Footer from '@/components/Footer'
import { CATEGORIES, getCategoryBySlug } from '@/lib/constants'

interface Props {
  params: Promise<{ category: string }>
}

export async function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params
  const category = getCategoryBySlug(slug)
  if (!category) return {}
  return {
    title: `${category.label} — NearU`,
    description: category.subtitle,
  }
}

export default async function CategoryPage({ params }: Props) {
  const { category: slug } = await params
  const category = getCategoryBySlug(slug)

  if (!category) notFound()

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        showBack
        backHref="/"
        backLabel="Home"
        title={category.label}
      />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 py-10">
        {/* Page heading */}
        <div className="mb-8 animate-fade-up">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">{category.icon}</span>
            <h1 className="text-[28px] font-bold tracking-tight text-[#111111]">
              {category.label}
            </h1>
          </div>
          <p className="text-[15px] text-[#6B7280] ml-[52px]">{category.subtitle}</p>
        </div>

        {/* Section label */}
        <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4 animate-fade-up animate-fade-up-delay-1">
          Choose a subcategory
        </p>

        {/* Subcategory list */}
        <div className="flex flex-col gap-2.5 max-w-[640px]">
          {category.subcategories.map((sub, i) => (
            <SubcategoryCard
              key={sub.slug}
              categorySlug={category.slug}
              subcategory={sub}
              index={i}
            />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
