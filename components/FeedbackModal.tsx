'use client'

import { useState, useRef, useEffect } from 'react'
import { X, MessageSquare, ChevronDown, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FeedbackType = 'bug' | 'listing' | 'suggestion' | 'other'

interface FeedbackOption {
  value: FeedbackType
  label: string
  emoji: string
  placeholder: string
}

const FEEDBACK_OPTIONS: FeedbackOption[] = [
  { value: 'bug',        label: 'Bug report',    emoji: '🐛', placeholder: 'What happened? What did you expect instead?' },
  { value: 'listing',    label: 'Listing issue',  emoji: '📍', placeholder: "Which listing has a problem, and what's wrong with it?" },
  { value: 'suggestion', label: 'Suggestion',     emoji: '💡', placeholder: "What would make NearU better for you?" },
  { value: 'other',      label: 'Other',          emoji: '📬', placeholder: "Tell us what's on your mind." },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [type, setType]           = useState<FeedbackType>('bug')
  const [message, setMessage]     = useState('')
  const [email, setEmail]         = useState('')
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg]   = useState('')
  const [showTypes, setShowTypes] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef  = useRef<HTMLDivElement>(null)

  // Auto-focus textarea when opening
  useEffect(() => {
    if (open) {
      setStatus('idle')
      setErrorMsg('')
      setTimeout(() => textareaRef.current?.focus(), 80)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showTypes) return
    const handler = () => setShowTypes(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showTypes])

  if (!open) return null

  const selected = FEEDBACK_OPTIONS.find(o => o.value === type)!
  const canSubmit = message.trim().length >= 5 && status !== 'loading'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message: message.trim(),
          email:   email.trim(),
          pageUrl: window.location.href,
          _hp:     '',  // honeypot — always empty from real users
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data?.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
      } else {
        setStatus('success')
      }
    } catch {
      setErrorMsg('Network error — please check your connection.')
      setStatus('error')
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#E5E7EB] overflow-hidden"
          style={{ animation: 'feedbackSlideUp 0.28s cubic-bezier(0.16,1,0.3,1) both' }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#F3F4F6]">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#6B7280]" />
              <span className="text-[15px] font-semibold text-[#111111]">Send feedback</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F3F4F6] transition-colors text-[#6B7280]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {status === 'success' ? (
            /* ── Success state ── */
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <p className="text-[15px] font-semibold text-[#111111]">Got it — thanks!</p>
              <p className="text-[13px] text-[#6B7280]">We read every report and appreciate you taking the time.</p>
              <button
                onClick={onClose}
                className="mt-2 text-[13px] font-medium text-[#111111] underline underline-offset-2"
              >
                Close
              </button>
            </div>
          ) : (
            /* ── Form ── */
            <form onSubmit={handleSubmit} noValidate className="px-5 pt-4 pb-5 flex flex-col gap-4">
              {/* Type selector */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setShowTypes(v => !v)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors text-left text-[14px] text-[#111111]"
                >
                  <span>{selected.emoji} {selected.label}</span>
                  <ChevronDown className={`w-4 h-4 text-[#9CA3AF] transition-transform ${showTypes ? 'rotate-180' : ''}`} />
                </button>

                {showTypes && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-[#E5E7EB] rounded-2xl shadow-lg z-10 overflow-hidden">
                    {FEEDBACK_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setType(opt.value); setShowTypes(false) }}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] transition-colors hover:bg-[#F9FAFB] ${type === opt.value ? 'text-[#111111] font-medium' : 'text-[#374151]'}`}
                      >
                        <span>{opt.emoji}</span>
                        <span>{opt.label}</span>
                        {type === opt.value && <span className="ml-auto text-[#111111]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message */}
              <div>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={selected.placeholder}
                  maxLength={2000}
                  rows={4}
                  required
                  className="w-full px-3.5 py-3 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-[14px] text-[#111111] placeholder-[#9CA3AF] resize-none focus:outline-none focus:border-[#111111] transition-colors leading-relaxed"
                />
                <div className="flex justify-end mt-1">
                  <span className="text-[11px] text-[#9CA3AF]">{message.length}/2000</span>
                </div>
              </div>

              {/* Optional email */}
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Your email (optional — for follow-up)"
                className="w-full px-3.5 py-2.5 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-[14px] text-[#111111] placeholder-[#9CA3AF] focus:outline-none focus:border-[#111111] transition-colors"
              />

              {/* Honeypot — visually hidden, aria-hidden, tabIndex -1 */}
              <input
                type="text"
                name="_hp"
                aria-hidden="true"
                tabIndex={-1}
                autoComplete="off"
                style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
              />

              {/* Error */}
              {status === 'error' && errorMsg && (
                <div className="flex items-start gap-2 px-3.5 py-3 rounded-2xl bg-red-50 border border-red-100">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-red-700">{errorMsg}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#111111] text-white text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#222222] transition-colors"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send feedback'
                )}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Slide-up keyframe (scoped to this element via style tag) */}
      <style>{`
        @keyframes feedbackSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
    </>
  )
}
