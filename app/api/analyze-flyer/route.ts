import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSessionUser } from '@/lib/auth-helper'
import { limiters, getRequestKey, rateLimitResponse } from '@/lib/rate-limit'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  // Require an authenticated session — this endpoint calls a paid external API
  // and must not be publicly accessible to prevent cost-abuse.
  const user = await getSessionUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 10 per user per hour (Claude API costs real money)
  const rl = limiters.analyzeFlyer.check(getRequestKey(request, user.id))
  if (rl.limited) return rateLimitResponse(rl.resetIn)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI analysis not configured' }, { status: 503 })
  }

  let imageUrl: string | undefined
  let imageBase64: string | undefined
  let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | undefined

  try {
    const body = await request.json()
    imageUrl   = typeof body.imageUrl   === 'string' ? body.imageUrl   : undefined
    imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined
    mediaType  = body.mediaType

    if (!imageUrl && !imageBase64) throw new Error('Missing imageUrl or imageBase64')

    // Validate imageUrl — only allow https:// URLs to prevent SSRF to internal services
    if (imageUrl) {
      try {
        const parsed = new URL(imageUrl)
        if (parsed.protocol !== 'https:') throw new Error('only https URLs allowed')
      } catch {
        return NextResponse.json({ error: 'Invalid imageUrl' }, { status: 400 })
      }
    }

    // Sanity-check base64 length (5 MB raw ≈ ~6.7 MB base64)
    if (imageBase64 && imageBase64.length > 7_000_000) {
      return NextResponse.json({ error: 'Image too large' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const imageSource = imageBase64
    ? ({ type: 'base64', media_type: mediaType ?? 'image/jpeg', data: imageBase64 } as const)
    : ({ type: 'url', url: imageUrl! } as const)

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: imageSource,
            },
            {
              type: 'text',
              text: `You are analyzing an image for the Aggie Map platform — a community discovery app for UC Davis students and Davis, CA residents. The image may be an event flyer, Instagram screenshot, poster, social media graphic, or any promotional material.

Your job: extract as much structured information as possible. Be aggressive about inferring details even from messy, stylized, or Instagram-style images.

Respond ONLY with a valid JSON object — no markdown fences, no explanation, nothing else.

Return this exact shape:
{
  "title": "concise event or place name (required — infer from context if not explicit)",
  "description": "1-3 sentence description of what this is",
  "category": one of ["events","food","outdoor","study","shopping","campus"],
  "subcategory": the best matching slug from below,
  "tags": array of applicable strings from ["free","paid","student-friendly","indoor","outdoor","weekend","beginner-friendly","networking","music","sports","food","academic","social","career","art"],
  "start_time": "ISO 8601 datetime string or null — if only date given, use T00:00:00",
  "end_time": "ISO 8601 datetime string or null",
  "location_name": "venue or building name or null",
  "address": "full street address including city and state, or null"
}

Subcategory slugs by category:
events: sports, club-student-org, social-party, academic-lecture, career-networking, arts-music, volunteer
food: restaurant, cafe, dessert, cheap-eats
outdoor: parks, trails, scenic-spots
study: library, cafe-study-spots, quiet-spaces, group-study
shopping: grocery, fashion, local-shops, weekend-market
campus: student-services, campus-events, resource-centers, department-activities

Key extraction rules:
- If only month/day shown, assume year 2026
- Convert relative times ("7pm") to ISO: use today's date or the stated date
- UC Davis address fallback: "1 Shields Ave, Davis, CA 95616"
- For Instagram screenshots: look for text in captions, bios, story overlays
- For club/org flyers: likely category=events, subcategory=club-student-org
- For food imagery/menus: category=food
- title must never be null — derive from any visible text if needed`,
            },
          ],
        },
      ],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('Flyer analysis error:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
