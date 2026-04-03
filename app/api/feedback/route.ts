import { NextRequest, NextResponse } from 'next/server'

// ── Sliding-window rate limiter — per IP, not global ─────────────────────────
//   Allows up to MAX_REQUESTS within WINDOW_MS before blocking.
//   Dev mode: always passes through.
const hitMap = new Map<string, number[]>()
const WINDOW_MS    = 5 * 60 * 1_000  // 5-minute sliding window
const MAX_REQUESTS = 5                // submissions allowed per window per IP
const MAX_MSG_LENGTH = 2_000

function isRateLimited(ip: string): boolean {
  // Always allow in non-production environments
  if (process.env.NODE_ENV !== 'production') return false

  const now  = Date.now()
  const hits = (hitMap.get(ip) ?? []).filter(t => now - t < WINDOW_MS)

  if (hits.length >= MAX_REQUESTS) return true

  // Record this hit and update
  hits.push(now)
  hitMap.set(ip, hits)

  // Prune stale IPs periodically to avoid unbounded growth
  if (hitMap.size > 1_000) {
    for (const [k, v] of hitMap) {
      if (v.every(t => now - t >= WINDOW_MS)) hitMap.delete(k)
    }
  }

  return false
}

export async function POST(req: NextRequest) {
  // ── IP ─────────────────────────────────────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a few minutes.' },
      { status: 429 },
    )
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // ── Honeypot — bots fill this; humans don't see it ────────────────────────
  if (body._hp) {
    // silently accept so bots don't know they were caught
    return NextResponse.json({ ok: true })
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const type    = String(body.type    ?? '').trim()
  const message = String(body.message ?? '').trim()
  const email   = String(body.email   ?? '').trim()
  const pageUrl = String(body.pageUrl ?? '').trim()

  const VALID_TYPES = ['bug', 'listing', 'suggestion', 'other'] as const
  if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    return NextResponse.json({ error: 'Invalid feedback type.' }, { status: 400 })
  }
  if (message.length < 5) {
    return NextResponse.json({ error: 'Message too short.' }, { status: 400 })
  }
  if (message.length > MAX_MSG_LENGTH) {
    return NextResponse.json({ error: 'Message too long.' }, { status: 400 })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  // ── Env vars ───────────────────────────────────────────────────────────────
  const apiKey   = process.env.RESEND_API_KEY
  const toEmail  = process.env.FEEDBACK_EMAIL
  const fromEmail = process.env.FEEDBACK_FROM_EMAIL ?? 'onboarding@resend.dev'

  if (!apiKey || !toEmail) {
    console.error('[feedback] Missing RESEND_API_KEY or FEEDBACK_EMAIL env vars')
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  // ── Build email ────────────────────────────────────────────────────────────
  const typeLabel: Record<string, string> = {
    bug:        '🐛 Bug Report',
    listing:    '📍 Listing Issue',
    suggestion: '💡 Suggestion',
    other:      '📬 Other',
  }

  const htmlBody = `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111111">
  <h2 style="margin:0 0 4px 0;font-size:18px">${typeLabel[type]}</h2>
  <p style="margin:0 0 20px 0;color:#6B7280;font-size:13px">
    Received via NearU feedback form
  </p>

  <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px;margin-bottom:20px">
    <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.6">${escHtml(message)}</p>
  </div>

  <table style="font-size:13px;color:#374151;border-collapse:collapse;width:100%">
    ${email ? `<tr><td style="padding:4px 0;font-weight:600;width:90px">Reply-to</td><td style="padding:4px 0">${escHtml(email)}</td></tr>` : ''}
    ${pageUrl ? `<tr><td style="padding:4px 0;font-weight:600">Page</td><td style="padding:4px 0"><a href="${escHtml(pageUrl)}" style="color:#3B82F6">${escHtml(pageUrl)}</a></td></tr>` : ''}
    <tr><td style="padding:4px 0;font-weight:600">IP</td><td style="padding:4px 0;color:#9CA3AF">${escHtml(ip)}</td></tr>
    <tr><td style="padding:4px 0;font-weight:600">Time</td><td style="padding:4px 0;color:#9CA3AF">${new Date().toUTCString()}</td></tr>
  </table>
</div>`.trim()

  // ── Send via Resend ────────────────────────────────────────────────────────
  try {
    const payload: Record<string, unknown> = {
      from:    `NearU Feedback <${fromEmail}>`,
      to:      [toEmail],
      subject: `[NearU] ${typeLabel[type]}`,
      html:    htmlBody,
    }
    if (email) payload.reply_to = email

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[feedback] Resend error:', res.status, errText)
      return NextResponse.json({ error: 'Failed to send. Please try again.' }, { status: 502 })
    }
  } catch (err) {
    console.error('[feedback] Network error sending email:', err)
    return NextResponse.json({ error: 'Failed to send. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

// ── Minimal HTML escaping ──────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
