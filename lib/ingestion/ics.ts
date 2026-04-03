/**
 * Aggie Map — Minimal ICS (iCalendar) parser
 *
 * Handles VCALENDAR/VEVENT format as produced by The Events Calendar
 * WordPress plugin (used by davisdowntown.com, visitdavis.org, etc.)
 *
 * Supports:
 *  - Line folding (continuation lines starting with CRLF + space/tab)
 *  - TZID parameter (America/Los_Angeles with PDT/PST approximation)
 *  - VALUE=DATE for all-day events
 *  - Basic text unescaping (\, \; \n \\)
 */

export interface ICSEvent {
  uid:         string
  summary:     string
  dtstart:     Date | null
  dtend:       Date | null
  description: string | null
  url:         string | null
  location:    string | null
}

/**
 * Unfold ICS lines.
 * RFC 5545 §3.1: lines may be folded at 75 octets; continuation lines
 * start with a single space or horizontal tab.
 */
function unfold(icsText: string): string {
  return icsText.replace(/\r?\n[ \t]/g, '')
}

/**
 * Parse an ICS date/time value into a JS Date.
 *
 * Handled formats:
 *  20260402T180000Z        → UTC
 *  20260402T180000         → apply tzid offset if known, else UTC
 *  20260402                → all-day → noon UTC (preserves calendar date)
 */
function parseICSDate(raw: string, tzid?: string): Date | null {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, Y, M, D, h = '00', min = '00', s = '00', utcFlag] = m

  // Explicit UTC suffix
  if (utcFlag) {
    return new Date(`${Y}-${M}-${D}T${h}:${min}:${s}Z`)
  }

  // All-day event (no time component) → use noon UTC to keep the date stable across timezones
  if (!m[4]) {
    return new Date(`${Y}-${M}-${D}T12:00:00Z`)
  }

  // Known LA/Pacific timezone
  if (tzid && /Los_Angeles|Pacific/i.test(tzid)) {
    // DST approximation: PDT (UTC-7) from mid-March through early November
    // month 3–10 = PDT; month 11–2 = PST
    const month = parseInt(M, 10)
    const offset = month >= 3 && month <= 10 ? '-07:00' : '-08:00'
    return new Date(`${Y}-${M}-${D}T${h}:${min}:${s}${offset}`)
  }

  // Unknown timezone — treat as UTC (minor inaccuracy acceptable for display)
  return new Date(`${Y}-${M}-${D}T${h}:${min}:${s}Z`)
}

/** Strip HTML tags that sometimes appear in DESCRIPTION fields */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Decode ICS text escaping */
function decodeICSText(raw: string): string {
  return stripHtml(
    raw
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\n/gi, '\n')
      .replace(/\\\\/g, '\\')
      .trim()
  )
}

/** Convert any UID to a safe external_id fragment */
export function icsUidToSlug(uid: string): string {
  return uid
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80)
}

/**
 * Parse a full ICS calendar string and return all upcoming VEVENT entries.
 * Past events (ended more than 24 h ago) are silently dropped.
 */
export function parseICS(icsText: string): ICSEvent[] {
  const cutoff   = new Date(Date.now() - 86_400_000)
  const unfolded = unfold(icsText)
  const blocks   = unfolded.split(/BEGIN:VEVENT/).slice(1)  // first element is VCALENDAR header
  const events: ICSEvent[] = []

  for (const block of blocks) {
    const endIdx  = block.indexOf('END:VEVENT')
    const content = endIdx >= 0 ? block.slice(0, endIdx) : block
    const lines   = content.split(/\r?\n/)

    // Build a props map: propName → value, tzids map: propName → tzid param
    const props:  Record<string, string> = {}
    const tzids:  Record<string, string> = {}

    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx < 0) continue

      const nameWithParams = line.slice(0, colonIdx)
      const value          = line.slice(colonIdx + 1)
      const parts          = nameWithParams.split(';')
      const propName       = parts[0].toUpperCase()

      for (const param of parts.slice(1)) {
        if (param.toUpperCase().startsWith('TZID=')) {
          tzids[propName] = param.slice(5)
        }
      }
      props[propName] = value
    }

    const summary = decodeICSText(props['SUMMARY'] ?? '')
    if (!summary) continue

    const dtstart = parseICSDate(props['DTSTART'] ?? '', tzids['DTSTART'])
    const dtend   = parseICSDate(props['DTEND']   ?? '', tzids['DTEND'])

    // Drop past events (use end if available, else start)
    const expiryDt = dtend ?? dtstart
    if (expiryDt && expiryDt < cutoff) continue

    const rawDesc = props['DESCRIPTION']
    const description = rawDesc ? decodeICSText(rawDesc).slice(0, 1_000) : null

    events.push({
      uid:         props['UID'] ?? summary,
      summary,
      dtstart,
      dtend,
      description,
      url:         props['URL']      ? props['URL'].trim()                  : null,
      location:    props['LOCATION'] ? decodeICSText(props['LOCATION'])     : null,
    })
  }

  return events
}
