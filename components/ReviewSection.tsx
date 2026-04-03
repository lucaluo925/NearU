'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, Star } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { useToast } from '@/components/Toast'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Review {
  id: string
  rating: number
  comment: string | null
  created_at: string
  author: string
}

interface ReviewData {
  reviews: Review[]
  avg_rating: number | null
  review_count: number
}

// ── Star display ──────────────────────────────────────────────────────────────

function StarDisplay({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'w-5 h-5' : size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(sz, n <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-[#D1D5DB]')}
        />
      ))}
    </div>
  )
}

// ── Star input ────────────────────────────────────────────────────────────────

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="focus:outline-none"
          aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
        >
          <Star
            className={cn(
              'w-7 h-7 transition-colors',
              n <= (hover || value) ? 'text-amber-400 fill-amber-400' : 'text-[#D1D5DB] hover:text-amber-300'
            )}
          />
        </button>
      ))}
    </div>
  )
}

// ── Single review row ─────────────────────────────────────────────────────────

function ReviewRow({ review }: { review: Review }) {
  const date = new Date(review.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  return (
    <div className="flex flex-col gap-1.5 py-4 border-b border-[#F3F4F6] last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StarDisplay rating={review.rating} size="sm" />
          <span className="text-[12px] font-semibold text-[#374151]">{review.author}</span>
        </div>
        <span className="text-[11px] text-[#9CA3AF] shrink-0">{date}</span>
      </div>
      {review.comment && (
        <p className="text-[13px] text-[#6B7280] leading-relaxed">{review.comment}</p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewSection({ itemId }: { itemId: string }) {
  const { show } = useToast()
  const [data, setData] = useState<ReviewData | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const supabase = createBrowserSupabase()

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/reviews?item_id=${itemId}`)
    if (res.ok) setData(await res.json())
  }, [itemId])

  useEffect(() => {
    loadData()
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null))
  }, [loadData]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0) { setSubmitError('Please select a star rating.'); return }
    setSubmitError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, rating, comment }),
      })
      const json = await res.json()
      if (!res.ok) { setSubmitError(json.error ?? 'Failed to submit'); return }
      const isFirstReview = !submitted
      setSubmitted(true)
      setRating(0)
      setComment('')
      await loadData()
      // Show points toast on first review (updates don't earn additional points)
      if (isFirstReview) show('+5 pts — Review posted ⭐')
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-8">
      {/* Aggregate */}
      {data && data.review_count > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <StarDisplay rating={data.avg_rating ?? 0} size="lg" />
          <span className="text-[20px] font-bold text-[#111111]">{data.avg_rating}</span>
          <span className="text-[14px] text-[#9CA3AF]">({data.review_count} {data.review_count === 1 ? 'review' : 'reviews'})</span>
        </div>
      )}

      {/* Section header */}
      <h2 className="text-[18px] font-bold text-[#111111] mb-5">Reviews</h2>

      {/* Review form */}
      {!userId ? (
        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl px-5 py-4 mb-6 text-center">
          <p className="text-[14px] text-[#6B7280] mb-3">Sign in to leave a review — earn 5 pts ⭐</p>
          <Link
            href={`/login?from=${encodeURIComponent(`/listing/${itemId}`)}`}
            className="inline-flex items-center text-[13px] font-semibold bg-[#111111] text-white px-4 py-2 rounded-xl hover:bg-[#333] transition-colors"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white border border-[#E5E7EB] rounded-2xl p-5 mb-6">
          <p className="text-[13px] font-semibold text-[#374151] mb-3">
            {submitted ? 'Update your review' : 'Write a review'}
          </p>

          <div className="mb-4">
            <StarInput value={rating} onChange={setRating} />
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share your experience (optional)"
            rows={3}
            className="w-full border border-[#E5E7EB] rounded-xl px-4 py-3 text-[13px] text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111111]/10 focus:border-[#D1D5DB] resize-none transition-all mb-3"
          />

          {submitError && (
            <p className="text-[12px] text-red-600 mb-3">{submitError}</p>
          )}
          {submitted && !submitError && (
            <p className="text-[12px] text-emerald-600 mb-3">Thanks for your review ✓</p>
          )}

          <button
            type="submit"
            disabled={submitting || rating === 0}
            className="flex items-center gap-2 bg-[#111111] text-white text-[13px] font-semibold px-4 py-2 rounded-xl hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Submitting…' : submitted ? 'Update Review' : 'Submit Review'}
          </button>
        </form>
      )}

      {/* Reviews list */}
      {data && data.reviews.length > 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl px-5">
          {data.reviews.map((r) => <ReviewRow key={r.id} review={r} />)}
        </div>
      ) : data && data.review_count === 0 ? (
        <p className="text-[13px] text-[#9CA3AF] text-center py-4">No reviews yet — be the first and earn 5 pts ⭐</p>
      ) : null}
    </div>
  )
}
