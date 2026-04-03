'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Upload, X, CheckCircle2, ArrowRight, ChevronDown, Sparkles, Loader2, Link2 } from 'lucide-react'
import { CATEGORIES } from '@/lib/constants'
import { REGION_OPTIONS } from '@/lib/types'
import TagSelector from '@/components/TagSelector'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/Toast'

type SuccessData = { id: string; category: string; subcategory: string; title: string }

interface FormState {
  title: string; category: string; subcategory: string; description: string
  location_name: string; address: string; city: string; region: string
  start_time: string; end_time: string
  external_link: string; tags: string[]
}

const EMPTY: FormState = {
  title: '', category: '', subcategory: '', description: '',
  location_name: '', address: '', city: '', region: '',
  start_time: '', end_time: '',
  external_link: '', tags: [],
}

export default function SubmitForm() {
  const router = useRouter()
  const { show: showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const [form, setForm] = useState<FormState>(EMPTY)
  const [flyerUrl, setFlyerUrl] = useState('')
  const [flyerPreview, setFlyerPreview] = useState('')
  const [instagramLink, setInstagramLink] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')

  const selectedCategory = CATEGORIES.find((c) => c.slug === form.category)

  function setField(field: keyof FormState, value: string | string[]) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'category') next.subcategory = ''
      return next
    })
    setError('')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFlyerPreview(URL.createObjectURL(file))
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setFlyerUrl(data.url)
      // Auto-analyze after upload
      await analyzeFlyer(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setFlyerPreview('')
    } finally {
      setUploading(false)
    }
  }

  async function analyzeFlyer(url: string) {
    setAnalyzing(true)
    setAnalyzeError('')
    try {
      const res = await fetch('/api/analyze-flyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      const ai = await res.json()
      if (!res.ok || ai.error) {
        setAnalyzeError('AI could not read this image. Fill in the form manually.')
        return
      }

      setForm((prev) => ({
        ...prev,
        title: ai.title || prev.title,
        description: ai.description || prev.description,
        category: ai.category || prev.category,
        subcategory: ai.subcategory || prev.subcategory,
        location_name: ai.location_name || prev.location_name,
        address: ai.address || prev.address,
        start_time: ai.start_time ? ai.start_time.slice(0, 16) : prev.start_time,
        end_time: ai.end_time ? ai.end_time.slice(0, 16) : prev.end_time,
        tags: ai.tags?.length ? ai.tags : prev.tags,
      }))
      showToast('AI filled in the details — review and edit before submitting', 'info')
    } catch {
      setAnalyzeError('AI analysis failed. You can still fill in the form manually.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleInstagramAnalyze() {
    if (!instagramLink.trim()) return
    setAnalyzing(true)
    setAnalyzeError('')
    try {
      // Use OpenGraph/oEmbed to get the image URL from an Instagram link
      const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(instagramLink)}&fields=thumbnail_url`
      // Fallback: just pass the link directly as imageUrl and let the AI handle whatever it can
      const res = await fetch('/api/analyze-flyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: instagramLink }),
      })
      const ai = await res.json()
      if (!res.ok || ai.error) {
        setAnalyzeError('Could not analyze this link. Try uploading a screenshot instead.')
        return
      }
      setForm((prev) => ({
        ...prev,
        title: ai.title || prev.title,
        description: ai.description || prev.description,
        category: ai.category || prev.category,
        subcategory: ai.subcategory || prev.subcategory,
        location_name: ai.location_name || prev.location_name,
        address: ai.address || prev.address,
        start_time: ai.start_time ? ai.start_time.slice(0, 16) : prev.start_time,
        end_time: ai.end_time ? ai.end_time.slice(0, 16) : prev.end_time,
        tags: ai.tags?.length ? ai.tags : prev.tags,
      }))
      showToast('AI filled in the details from the link — review before submitting', 'info')
    } catch {
      setAnalyzeError('Could not analyze this link. Try uploading a screenshot instead.')
    } finally {
      setAnalyzing(false)
    }
  }

  function clearFlyer() {
    setFlyerUrl('')
    setFlyerPreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.title.trim()) return setError('Title is required.')
    if (!form.category) return setError('Category is required.')
    if (!form.subcategory) return setError('Subcategory is required.')
    if (!form.address.trim()) return setError('Address is required.')
    if (!form.external_link.trim() && !flyerUrl) {
      return setError('Please provide either an external link or a flyer image.')
    }
    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      return setError('End time must be after start time.')
    }

    setSubmitting(true)
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        subcategory: form.subcategory,
        description: form.description.trim() || undefined,
        location_name: form.location_name.trim() || undefined,
        address: form.address.trim(),
        city: form.city.trim() || undefined,
        region: form.region || undefined,
        start_time: form.start_time || undefined,
        end_time: form.end_time || undefined,
        external_link: form.external_link.trim() || undefined,
        flyer_image_url: flyerUrl || undefined,
        tags: form.tags,
      }
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) throw new Error('This listing already exists — it may have been submitted before.')
        throw new Error(data.error ?? 'Submission failed')
      }
      setSuccess({ id: data.id, category: form.category, subcategory: form.subcategory, title: form.title })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6 animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-5">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h2 className="text-[22px] font-bold text-[#111111] mb-2">Submitted!</h2>
        <p className="text-[15px] text-[#6B7280] max-w-[340px] leading-relaxed mb-8">
          <span className="font-semibold text-[#111111]">{success.title}</span> is under review and will appear once approved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-[340px]">
          <button
            onClick={() => { setSuccess(null); setForm(EMPTY); setFlyerUrl(''); setFlyerPreview('') }}
            className="flex-1 text-[14px] font-medium border border-[#E5E7EB] text-[#374151] px-4 py-2.5 rounded-full hover:bg-[#F9FAFB] transition-colors"
          >
            Submit Another
          </button>
          <button
            onClick={() => router.push('/')}
            className="flex-1 flex items-center justify-center gap-2 text-[14px] font-semibold bg-[#111111] text-white px-4 py-2.5 rounded-full hover:bg-[#333] transition-colors"
          >
            Go Home <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  const inputCls = 'w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-[14px] text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111111]/8 focus:border-[#D1D5DB] transition-all'
  const labelCls = 'block text-[13px] font-semibold text-[#374151] mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Title */}
      <div>
        <label className={labelCls}>Title <span className="text-red-400">*</span></label>
        <input type="text" placeholder="e.g., Coffee House Trivia Night" value={form.title}
          onChange={(e) => setField('title', e.target.value)} className={inputCls} maxLength={200} required />
      </div>

      {/* Category + Subcategory */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Category <span className="text-red-400">*</span></label>
          <div className="relative">
            <select value={form.category} onChange={(e) => setField('category', e.target.value)}
              className={cn(inputCls, 'appearance-none cursor-pointer pr-9')} required>
              <option value="">Select...</option>
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.icon} {c.label}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Subcategory <span className="text-red-400">*</span></label>
          <div className="relative">
            <select value={form.subcategory} onChange={(e) => setField('subcategory', e.target.value)}
              disabled={!selectedCategory} className={cn(inputCls, 'appearance-none cursor-pointer pr-9 disabled:opacity-50')} required>
              <option value="">Select...</option>
              {selectedCategory?.subcategories.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="border-t border-[#F3F4F6]" />

      {/* Location */}
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Location Name</label>
          <input type="text" placeholder="e.g., The Coffee House" value={form.location_name}
            onChange={(e) => setField('location_name', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Address <span className="text-red-400">*</span></label>
          <input type="text" placeholder="e.g., 1 Shields Ave, Davis, CA 95616" value={form.address}
            onChange={(e) => setField('address', e.target.value)} className={inputCls} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>City</label>
            <input type="text" placeholder="e.g., Davis" value={form.city}
              onChange={(e) => setField('city', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Area</label>
            <div className="relative">
              <select value={form.region} onChange={(e) => setField('region', e.target.value)}
                className={cn(inputCls, 'appearance-none cursor-pointer pr-9')}>
                <option value="">Select...</option>
                {REGION_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Dates — events only */}
      {form.category === 'events' && (
        <>
          <div className="border-t border-[#F3F4F6]" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Time</label>
              <input type="datetime-local" value={form.start_time}
                onChange={(e) => setField('start_time', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>End Time</label>
              <input type="datetime-local" value={form.end_time} min={form.start_time}
                onChange={(e) => setField('end_time', e.target.value)} className={inputCls} />
            </div>
          </div>
        </>
      )}

      <div className="border-t border-[#F3F4F6]" />

      {/* External link */}
      <div>
        <label className={labelCls}>
          External Link {!flyerPreview && <span className="text-red-400">*</span>}
        </label>
        <input type="url" placeholder="https://..." value={form.external_link}
          onChange={(e) => setField('external_link', e.target.value)} className={inputCls} />
        <p className="text-[11px] text-[#9CA3AF] mt-1">Link to ticket page, website, or social post.</p>
      </div>

      {/* Flyer upload */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={cn(labelCls, 'mb-0')}>
            Flyer Image {!form.external_link.trim() && <span className="text-red-400">*</span>}
          </label>
          {analyzing && (
            <span className="flex items-center gap-1.5 text-[12px] text-violet-600 font-medium">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI analyzing...
            </span>
          )}
        </div>
        <p className="text-[12px] text-[#9CA3AF] mb-2">
          Upload a flyer and AI will auto-fill the form. Max 5MB (JPEG, PNG, WebP).
        </p>

        {flyerPreview ? (
          <div className="relative rounded-2xl overflow-hidden border border-[#E5E7EB] bg-[#F3F4F6]">
            <Image src={flyerPreview} alt="Flyer preview" width={560} height={280}
              className="w-full h-[200px] object-cover" />
            {(uploading || analyzing) && (
              <div className="absolute inset-0 bg-white/75 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#6B7280]" />
                <span className="text-[13px] text-[#6B7280]">
                  {uploading ? 'Uploading...' : 'AI analyzing flyer...'}
                </span>
              </div>
            )}
            <button type="button" onClick={clearFlyer}
              className="absolute top-3 right-3 w-7 h-7 bg-white rounded-full border border-[#E5E7EB] flex items-center justify-center shadow-sm hover:bg-[#F9FAFB] transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-[#E5E7EB] rounded-2xl py-10 flex flex-col items-center gap-2.5 hover:border-[#D1D5DB] hover:bg-[#F9FAFB] transition-all cursor-pointer">
            <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center">
              <Upload className="w-5 h-5 text-[#6B7280]" />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-medium text-[#374151]">Upload flyer</p>
              <p className="text-[12px] text-[#9CA3AF] mt-0.5">AI will auto-fill from it</p>
            </div>
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange} className="hidden" />

        {/* Instagram / link analysis */}
        {!flyerPreview && (
          <div className="mt-3">
            <p className="text-[12px] text-[#9CA3AF] mb-2">Or paste an Instagram / social link:</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9CA3AF]" />
                <input
                  type="url"
                  placeholder="https://www.instagram.com/p/..."
                  value={instagramLink}
                  onChange={(e) => { setInstagramLink(e.target.value); setAnalyzeError('') }}
                  className={cn(inputCls, 'pl-9 text-[13px]')}
                />
              </div>
              <button
                type="button"
                onClick={handleInstagramAnalyze}
                disabled={!instagramLink.trim() || analyzing}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold bg-[#111111] text-white rounded-xl hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Analyze
              </button>
            </div>
          </div>
        )}

        {analyzeError && (
          <p className="text-[12px] text-amber-600 mt-2">{analyzeError}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea placeholder="Brief description..." value={form.description}
          onChange={(e) => setField('description', e.target.value)}
          rows={3} className={cn(inputCls, 'resize-none')} maxLength={500} />
        <p className="text-[11px] text-[#9CA3AF] mt-1 text-right">{form.description.length}/500</p>
      </div>

      {/* Tags */}
      <div>
        <label className={labelCls}>Tags</label>
        <p className="text-[12px] text-[#9CA3AF] mb-3">Select all that apply.</p>
        <TagSelector value={form.tags} onChange={(tags) => setForm((prev) => ({ ...prev, tags }))} />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-4 py-3">
          <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={submitting || uploading || analyzing}
        className="w-full bg-[#111111] text-white text-[15px] font-semibold py-3.5 rounded-2xl hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
        {submitting
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</span>
          : 'Submit Listing'}
      </button>
    </form>
  )
}
