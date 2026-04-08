import { NextRequest, NextResponse } from 'next/server'

/**
 * Sliding-window in-process rate limiter.
 *
 * Design
 * ──────
 * Each RateLimiter instance holds its own Map, so endpoint windows never
 * bleed into each other.  Keys are either `u:<user_id>` (preferred for
 * authenticated routes) or `ip:<addr>` (fallback).
 *
 * Algorithm: sliding window with per-key timestamp arrays.  On every check
 * timestamps older than windowMs are evicted, making the limit apply to the
 * last <windowMs> ms rather than a fixed clock bucket.
 *
 * Memory
 * ──────
 * Worst case per instance: 10,000 keys × max timestamps × 8 bytes.
 * At the highest limit (120/min): 10,000 × 120 × 8 ≈ 9.6 MB — acceptable.
 * A prune pass runs whenever the map exceeds 10,000 entries, evicting all
 * keys whose entire timestamp array has expired.  The pass is O(n) but runs
 * at most once per 10K new unique keys, so amortised cost is O(1).
 *
 * Multi-instance caveat
 * ─────────────────────
 * State is per-process (Vercel Lambda instance).  Under multi-instance
 * deployments each instance enforces its limit independently, so effective
 * throughput can be up to max × warm_instances.  This is acceptable at
 * this scale.  Upgrade path: swap RateLimiter internals for Upstash Redis
 * while keeping the same public interface.
 */

// ─── Core class ──────────────────────────────────────────────────────────────

export interface RateLimitResult {
  limited:   boolean
  remaining: number
  /** Milliseconds until the oldest in-window hit falls out of the window */
  resetIn:   number
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    /** Maximum requests allowed within the window */
    readonly max: number,
    /** Window length in milliseconds */
    readonly windowMs: number,
    /**
     * Short name used in log output.  e.g. 'analyze-flyer'.
     * When set, every rate-limit hit is logged with an anonymized key.
     */
    private readonly name?: string,
  ) {}

  check(key: string): RateLimitResult {
    const now   = Date.now()
    const raw   = this.hits.get(key) ?? []
    // Evict timestamps that have slid out of the window
    const valid = raw.filter(t => now - t < this.windowMs)

    if (valid.length >= this.max) {
      // Time until the oldest hit ages out of the window
      const resetIn = this.windowMs - (now - valid[0])
      // Abuse-resistant log: prefix + first 8 chars of key only (no full ID / IP)
      if (this.name) {
        const safe = key.slice(0, 2) + key.slice(2, 10) + '…'
        console.warn(`[rl:${this.name}] limited key=${safe} ts=${new Date().toISOString()}`)
      }
      return { limited: true, remaining: 0, resetIn: Math.max(resetIn, 0) }
    }

    valid.push(now)
    this.hits.set(key, valid)
    this._maybePrune(now)

    return { limited: false, remaining: this.max - valid.length, resetIn: this.windowMs }
  }

  private _maybePrune(now: number): void {
    if (this.hits.size <= 10_000) return
    for (const [k, v] of this.hits) {
      if (v.every(t => now - t >= this.windowMs)) this.hits.delete(k)
    }
  }
}

// ─── Per-endpoint singletons ─────────────────────────────────────────────────
//
// Limits are chosen to allow generous normal usage while making automated
// abuse expensive or impossible at scale.

export const limiters = {
  /**
   * /api/analyze-flyer — 10 per user per hour
   *
   * Each call invokes Claude Haiku (~$0.001).  10/hr caps worst-case cost to
   * ~$0.01/user/hr.  A student submitting 2-3 events in one session and
   * retrying once each still has headroom.  Lower than any other limit
   * because the downstream cost is real money.
   */
  analyzeFlyer: new RateLimiter(10, 60 * 60_000, 'analyze-flyer'),

  /**
   * /api/upload — 30 per user per hour
   *
   * Each request writes a file to Supabase Storage.  30/hr covers a user
   * re-uploading multiple event images without enabling bulk storage abuse.
   * Normal submit flow is 1 upload; power users doing batch submissions are
   * comfortably within this.
   */
  upload: new RateLimiter(30, 60 * 60_000, 'upload'),

  /**
   * /api/user/favorites (POST) — 120 per user per minute
   *
   * Pure Postgres upsert/delete.  Users browse and tap save/unsave rapidly;
   * 120/min (2/sec) accommodates the most aggressive normal interaction rate
   * while blocking scripts that hammer the endpoint.
   */
  favorites: new RateLimiter(120, 60_000, 'favorites'),

  /**
   * /api/pet/xp — 60 per user per minute
   *
   * One XP call fires per user action (save, share, calendar-add).  Mirrors
   * the favorites write rate since both are triggered by the same actions.
   * The RPC itself is cheap but unbounded calls inflate XP illegitimately.
   */
  petXp: new RateLimiter(60, 60_000, 'pet-xp'),

  /**
   * /api/points/award — 60 per user per minute
   *
   * Same call-rate as petXp — both are invoked in sequence on user actions.
   * DB-level anti-abuse (oneTime / dedupeByItem / dailyCap) still applies;
   * this guard prevents wasted DB round-trips from automated requests.
   */
  pointsAward: new RateLimiter(60, 60_000, 'points-award'),

  /**
   * /api/interactions — 120 per IP per minute
   *
   * Public endpoint (no auth required).  Keyed by IP.  Migrated from the
   * inline implementation in interactions/route.ts.
   */
  interactions: new RateLimiter(120, 60_000, 'interactions'),
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the rate-limit key for a request.
 * Prefers user_id (stable, harder to spoof than IP); falls back to source IP.
 *
 * IP extraction on Vercel:
 *   Vercel's edge network prepends the real client IP to x-forwarded-for, so
 *   the first element is always the genuine client address.
 *   Using `||` (not `??`) so that an empty-string header falls through to the
 *   next option instead of producing a key like `ip:` that pools all
 *   empty-header requests together.
 */
export function getRequestKey(req: NextRequest, userId?: string): string {
  if (userId) return `u:${userId}`
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip  = xff || req.headers.get('x-real-ip') || 'unknown'
  return `ip:${ip}`
}

/**
 * Fast-path body-size guard for JSON POST endpoints.
 *
 * Checks the Content-Length header (if present) before the route calls
 * req.json(), preventing large payloads from being buffered into memory.
 *
 * Limitations:
 *  - Content-Length is optional (absent for chunked transfers).  This is a
 *    best-effort early rejection, not a hard cap.
 *  - Next.js itself has a default body-size limit (~4MB) which acts as the
 *    true floor.
 *
 * Returns a 413 NextResponse if the declared payload is too large,
 * or null if the request may proceed.
 */
export function guardBodySize(req: NextRequest, maxBytes: number): NextResponse | null {
  const cl = req.headers.get('content-length')
  if (cl !== null && parseInt(cl, 10) > maxBytes) {
    return new NextResponse(
      JSON.stringify({ error: 'Request body too large' }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return null
}

/**
 * Returns a 429 NextResponse with standard Retry-After and RateLimit headers.
 * Use `silent = true` for public endpoints where leaking 429 would reveal
 * internal structure (interactions endpoint pattern).
 */
export function rateLimitResponse(resetIn: number, silent = false): NextResponse {
  if (silent) {
    // Return 200 OK to avoid leaking rate-limit information to anonymous callers
    return NextResponse.json({ ok: true })
  }
  const retryAfterSec = Math.ceil(resetIn / 1000)
  return new NextResponse(
    JSON.stringify({ error: 'Too many requests', retryAfter: retryAfterSec }),
    {
      status: 429,
      headers: {
        'Content-Type':      'application/json',
        'Retry-After':       String(retryAfterSec),
        'X-RateLimit-Reset': String(Date.now() + resetIn),
      },
    },
  )
}
