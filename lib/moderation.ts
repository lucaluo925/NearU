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
  safety_level: 'safe' | 'medium' | 'high'
  confidence: number       // 0.0 – 1.0
  reason: string           // short explanation
  risk_score: number       // 0 – 100
  category_match: boolean  // does content match the chosen category?
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
  safety_level: 'safe',
  confidence: 0.5,
  reason: 'AI moderation unavailable — requires manual review.',
  risk_score: 20,
  category_match: true,
  auto_flag: false,
}

export async function moderateSubmission(
  item: SubmissionToModerate
): Promise<ModerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return FALLBACK

  try {
    const client = new Anthropic({ apiKey })

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
    if (!jsonMatch) return FALLBACK

    const parsed = JSON.parse(jsonMatch[0])

    const risk_score = Math.min(100, Math.max(0, Number(parsed.risk_score) || 20))
    const safety_level: ModerationResult['safety_level'] =
      parsed.safety_level === 'high' ? 'high'
        : parsed.safety_level === 'medium' ? 'medium'
        : 'safe'

    return {
      safety_level,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason ?? 'No reason provided').slice(0, 500),
      risk_score,
      category_match: parsed.category_match !== false,
      auto_flag: risk_score >= 66,
    }
  } catch (err) {
    console.warn('[moderation] AI check failed:', (err as Error).message)
    return FALLBACK
  }
}
