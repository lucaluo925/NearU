/**
 * AI-assisted content moderation for Aggie Map user submissions.
 *
 * Uses Anthropic Claude to evaluate submissions for:
 * - Inappropriate / unsafe content
 * - Spam or off-topic content
 * - Scams or misleading info
 * - Category relevance
 *
 * Risk mapping:
 *   safe   (0–30)  → status stays 'pending' (requires manual approval)
 *   medium (31–65) → status stays 'pending'  (more scrutiny recommended)
 *   high   (66+)   → status auto-set to 'flagged' (urgent review needed)
 */

import Anthropic from '@anthropic-ai/sdk'

export interface ModerationResult {
  status: 'completed' | 'unavailable'
  safety_level: 'safe' | 'medium' | 'high' | null
  confidence: number | null // 0.0 – 1.0
  reason: string           // short explanation
  risk_score: number | null // 0 – 100
  category_match: boolean | null // does content match the chosen category?
  auto_flag: boolean       // true if status should become 'flagged'
}

export interface SubmissionToModerate {
  title: string
  description?: string | null
  category: string
  subcategory: string
  address?: string | null
  external_link?: string | null
  tags?: string[]
}

const FALLBACK: ModerationResult = {
  status: 'unavailable',
  safety_level: null,
  confidence: null,
  reason: 'AI moderation unavailable — requires manual review.',
  risk_score: null,
  category_match: null,
  auto_flag: false,
}

export async function moderateSubmission(
  item: SubmissionToModerate
): Promise<ModerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || process.env.AI_FEATURES_ENABLED === 'false') return { ...FALLBACK }

  try {
    const client = new Anthropic({ apiKey, timeout: 8_000, maxRetries: 0 })

    const prompt = `You are a content moderator for Aggie Map, a UC Davis campus events and places app for students.

Evaluate this user submission and return ONLY a JSON object (no markdown, no explanation outside JSON):

Title: ${item.title}
Category: ${item.category} / ${item.subcategory}
Description: ${item.description ?? '(none)'}
Address: ${item.address ?? '(none)'}
External Link: ${item.external_link ?? '(none)'}
Tags: ${item.tags?.join(', ') ?? '(none)'}

Check for:
1. Inappropriate content (hate, violence, NSFW, harassment)
2. Spam, ads, or self-promotion unrelated to campus
3. Scams, phishing, or misleading information
4. Off-topic (not relevant to UC Davis / Davis / nearby area)
5. Category mismatch (does the content match the chosen category?)
6. Missing essential information

Return exactly this JSON shape:
{
  "safety_level": "safe" | "medium" | "high",
  "confidence": <number 0.0-1.0>,
  "reason": "<one sentence explanation>",
  "risk_score": <integer 0-100>,
  "category_match": <true|false>
}

risk_score guide: 0-30 = safe, 31-65 = medium concern, 66-100 = high risk / likely problematic`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''

    // Extract JSON from response (handles cases where model adds extra text)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ...FALLBACK }

    const parsed = JSON.parse(jsonMatch[0])

    // A missing, truncated or malformed verdict is NOT a successful safety check.
    if (response.stop_reason !== 'end_turn' ||
        !['safe', 'medium', 'high'].includes(parsed.safety_level) ||
        typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) ||
        parsed.confidence < 0 || parsed.confidence > 1 ||
        typeof parsed.risk_score !== 'number' || !Number.isInteger(parsed.risk_score) ||
        parsed.risk_score < 0 || parsed.risk_score > 100 ||
        typeof parsed.category_match !== 'boolean' ||
        typeof parsed.reason !== 'string' || !parsed.reason.trim()) return { ...FALLBACK }

    const risk_score = parsed.risk_score
    const safety_level = risk_score >= 66 ? 'high' : risk_score >= 31 ? 'medium' : 'safe'
    if (parsed.safety_level !== safety_level) return { ...FALLBACK }

    return {
      status: 'completed',
      safety_level,
      confidence: parsed.confidence,
      reason: parsed.reason.trim().slice(0, 500),
      risk_score,
      category_match: parsed.category_match,
      auto_flag: risk_score >= 66,
    }
  } catch (err) {
    // Do not log provider messages: they may contain submitted content.
    console.warn('[moderation] AI unavailable', { status: err instanceof Anthropic.APIError ? err.status : undefined })
    return { ...FALLBACK }
  }
}
