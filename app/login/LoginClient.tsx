'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Mail, Lock, User, CheckCircle2 } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { cn } from '@/lib/utils'

type Mode = 'signin' | 'signup'

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/admin'
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'

  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const supabase = createBrowserSupabase()

  // If already signed in, redirect immediately
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(from)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split('@')[0] },
            emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(from)}`,
          },
        })
        if (error) throw error
        setSuccess('Check your email to confirm your account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.replace(from)
        router.refresh()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-[14px] text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111111]/10 focus:border-[#D1D5DB] transition-all'

  if (success) {
    return (
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
        </div>
        <h2 className="text-[18px] font-bold text-[#111111] mb-2">Check your email</h2>
        <p className="text-[14px] text-[#6B7280] leading-relaxed mb-6">{success}</p>
        <button
          onClick={() => { setSuccess(''); setMode('signin') }}
          className="text-[13px] font-semibold text-[#374151] border border-[#E5E7EB] px-4 py-2 rounded-full hover:bg-[#F9FAFB] transition-colors"
        >
          Back to Sign In
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex bg-[#F3F4F6] rounded-xl p-1 mb-6">
        {(['signin', 'signup'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError('') }}
            className={cn(
              'flex-1 py-2 text-[13px] font-semibold rounded-lg transition-all',
              mode === m ? 'bg-white text-[#111111] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'
            )}
          >
            {m === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === 'signup' && (
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={cn(inputCls, 'pl-10')}
            />
          </div>
        )}

        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn(inputCls, 'pl-10')}
            required
            autoComplete="email"
          />
        </div>

        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn(inputCls, 'pl-10')}
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={6}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-3 py-2.5">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#111111] text-white text-[14px] font-semibold py-3 rounded-xl hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {mode === 'signup' ? 'Creating account…' : 'Signing in…'}
            </span>
          ) : mode === 'signup' ? (
            'Create Account'
          ) : (
            'Sign In'
          )}
        </button>
      </form>
    </div>
  )
}
