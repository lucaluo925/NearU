import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import Header from '@/components/Header'
import ItemListClient from './ItemListClient'
import Footer from '@/components/Footer'
import { SkeletonItemCard } from '@/components/SkeletonCard'
import { CATEGORIES, getCategoryBySlug, getSubcategoryLabel } from '@/lib/constants'

interface Props {
  params: Promise<{ category: string; subcategory: string }>
}

export async function generateStaticParams() {
  return CATEGORIES.flatMap((c) =>
    c.subcategories.map((s) => ({ category: c.slug, subcategory: s.slug }))
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: catSlug, subcategory: subSlug } = await params
  const category = getCategoryBySlug(catSlug)
  if (!category) return {}
  const subLabel = getSubcategoryLabel(catSlug, subSlug)
  return {
    title: `${subLabel} · ${category.label} — NearU`,
    description: `Browse ${subLabel} in ${category.label} around UC Davis and Davis, CA`,
  }
}

export default async function SubcategoryPage({ params }: Props) {
  const { category: catSlug, subcategory: subSlug } = await params
  const category = getCategoryBySlug(catSlug)
  if (!category) notFound()

  const subcategory = category.subcategories.find((s) => s.slug === subSlug)
  if (!subcategory) notFound()

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        showBack
        backHref={`/${catSlug}`}
        backLabel={category.label}
        title={subcategory.label}
      />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 py-10">
        {/* Page heading */}
        <div className="mb-8 animate-fade-up">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] text-[#9CA3AF]">{category.label}</span>
            <span className="text-[13px] text-[#C4C9D4]">/</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#111111]">
            {subcategory.label}
          </h1>
        </div>

        <Suspense
          fallback={
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonItemCard key={i} />
              ))}
            </div>
          }
        >
          <ItemListClient
            categorySlug={catSlug}
            subcategorySlug={subSlug}
            categoryLabel={category.label}
            subcategoryLabel={subcategory.label}
          />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
