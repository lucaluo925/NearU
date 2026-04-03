// lib/language-detection.ts
/**
 * Conservative language detection from event text.
 *
 * Design principles:
 *  1. Only show a language when there is STRONG, explicit evidence.
 *  2. Script detection requires a meaningful character count (≥ 5) to avoid
 *     false positives from random Unicode in descriptions.
 *  3. Tag-based detection ignores generic tags ("vietnamese", "chinese") that
 *     describe cuisine/culture, NOT the language the event is conducted in.
 *     Only "language:X" prefixed tags are treated as language signals.
 *  4. Keyword detection only triggers on explicit phrases like "in Vietnamese"
 *     or "Vietnamese-speaking" — NOT on org names like "Vietnamese Student Assoc."
 *  5. English is only surfaced in a clearly bilingual/multilingual context.
 *
 * If confidence is low → return [] → show nothing. That is always better
 * than showing wrong information.
 */

/** Minimum script character count to treat as a real language signal. */
const MIN_SCRIPT_CHARS = 5

function countScript(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

export function detectLanguages(
  title: string,
  description: string | null | undefined,
  tags: string[],
): string[] {
  // Only scan title + description. Tags are NOT scanned for script or general keywords —
  // cultural/cuisine tags produce far too many false positives.
  const corpus = `${title} ${description ?? ''}`
  const lower  = corpus.toLowerCase()
  const found  = new Set<string>()

  // ── 1. Script-based detection — high character threshold ──────────────────
  if (countScript(corpus, /[\u4E00-\u9FFF\u3400-\u4DBF]/g) >= MIN_SCRIPT_CHARS) found.add('中文')
  if (countScript(corpus, /[\uAC00-\uD7AF\u1100-\u11FF]/g) >= MIN_SCRIPT_CHARS) found.add('한국어')
  if (countScript(corpus, /[\u3040-\u309F\u30A0-\u30FF]/g) >= MIN_SCRIPT_CHARS) found.add('日本語')
  if (countScript(corpus, /[\u0600-\u06FF]/g)              >= MIN_SCRIPT_CHARS) found.add('العربية')
  if (countScript(corpus, /[\u0400-\u04FF]/g)              >= MIN_SCRIPT_CHARS) found.add('Русский')
  if (countScript(corpus, /[\u0900-\u097F]/g)              >= MIN_SCRIPT_CHARS) found.add('हिन्दी')
  if (countScript(corpus, /[\u0E00-\u0E7F]/g)              >= MIN_SCRIPT_CHARS) found.add('ภาษาไทย')

  // ── 2. Keyword detection — explicit language-of-event phrases only ────────
  // Triggers on: "in X", "X-speaking", "conducted in X", "bilingual X/English"
  // Does NOT trigger on org names, cuisine, or subject matter.
  if (/\b(en\s+español|in spanish|spanish[- ]speaking|bilingüe)\b/.test(lower))                     found.add('Español')
  if (/\b(in mandarin|in chinese|mandarin[- ]speaking|chinese[- ]speaking|普通话|广东话)\b/.test(lower)) found.add('中文')
  if (/\b(in vietnamese|vietnamese[- ]speaking|tiếng việt|bilingual vietnamese)\b/.test(lower))      found.add('Tiếng Việt')
  if (/\b(in korean|korean[- ]speaking|bilingual korean)\b/.test(lower))                             found.add('한국어')
  if (/\b(in japanese|japanese[- ]speaking)\b/.test(lower))                                          found.add('日本語')
  if (/\b(in arabic|arabic[- ]speaking|بالعربية)\b/.test(lower))                                   found.add('العربية')
  if (/\b(in french|en français|french[- ]speaking)\b/.test(lower))                                  found.add('Français')
  if (/\b(in portuguese|em português|portuguese[- ]speaking)\b/.test(lower))                         found.add('Português')
  if (/\b(in tagalog|in filipino|tagalog[- ]speaking)\b/.test(lower))                               found.add('Filipino')
  if (/\b(in punjabi|ਪੰਜਾਬੀ)\b/.test(lower))                                                      found.add('ਪੰਜਾਬੀ')
  if (/\b(in hindi|hindi[- ]speaking)\b/.test(lower))                                                found.add('हिन्दी')
  if (/\b(in farsi|in persian|فارسی)\b/.test(lower))                                                found.add('فارسی')

  // ── 3. Explicit language tags (admin/manual override only) ────────────────
  // Only tags prefixed with "language:" are treated as language signals.
  // e.g. "language:vietnamese" → Tiếng Việt
  // Generic tags ("vietnamese", "chinese", "spanish") are intentionally IGNORED.
  const langTagMap: Record<string, string> = {
    'language:spanish':    'Español',
    'language:chinese':    '中文',
    'language:mandarin':   '中文',
    'language:cantonese':  '中文',
    'language:vietnamese': 'Tiếng Việt',
    'language:korean':     '한국어',
    'language:japanese':   '日本語',
    'language:arabic':     'العربية',
    'language:french':     'Français',
    'language:portuguese': 'Português',
    'language:tagalog':    'Filipino',
    'language:hindi':      'हिन्दी',
    'language:farsi':      'فارسی',
  }
  for (const tag of tags) {
    const mapped = langTagMap[tag.toLowerCase()]
    if (mapped) found.add(mapped)
  }

  // ── 4. Return only when strong evidence exists ────────────────────────────
  if (found.size > 0) {
    return ['English', ...Array.from(found)]
  }

  // Explicit bilingual/multilingual marker with no specific language identified
  if (/\b(bilingual|multilingual|multi-lingual)\b/.test(lower)) {
    return ['English', '__bilingual__']
  }

  // No confident signal → return nothing → hide the language row entirely
  return []
}

/** Short display code for UI chips. */
export function languageCode(lang: string): string {
  const codes: Record<string, string> = {
    'English': 'EN', '中文': '中文', '한국어': '한', '日本語': '日',
    'العربية': 'AR', 'Español': 'ES', 'Tiếng Việt': 'VI',
    'Français': 'FR', 'Português': 'PT', 'Filipino': 'TL',
    'हिन्दी': 'HI', 'فارسی': 'FA', 'Русский': 'RU', 'ภาษาไทย': 'TH', 'ਪੰਜਾਬੀ': 'PA',
  }
  return codes[lang] ?? lang.slice(0, 2).toUpperCase()
}

export interface LanguageDisplay {
  chip:      string
  label:     string
  bilingual: boolean
}

/**
 * Format detected languages for display.
 * Returns null when there is no meaningful non-English language to show.
 */
export function formatLanguageDisplay(langs: string[]): LanguageDisplay | null {
  if (langs.length === 0) return null

  // Bilingual marker only
  if (langs.includes('__bilingual__') && langs.length <= 2) {
    return { chip: '🌐 Bilingual', label: 'Bilingual', bilingual: true }
  }

  const others = langs.filter((l) => l !== 'English' && l !== '__bilingual__')
  if (others.length === 0) return null  // English-only → hide

  const codes = others.map(languageCode)

  if (others.length === 1) {
    return { chip: `🌐 ${codes[0]} + EN`, label: `${others[0]} · English`, bilingual: true }
  }

  if (others.length === 2) {
    return { chip: `🌐 ${codes[0]} + ${codes[1]}`, label: `${others.join(' · ')} · English`, bilingual: false }
  }

  return { chip: '🌐 Multilingual', label: `${others.slice(0, 3).join(', ')} + more`, bilingual: false }
}
