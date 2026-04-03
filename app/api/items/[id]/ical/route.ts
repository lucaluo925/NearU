import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { Item } from '@/lib/types'

// ── ICS helpers ───────────────────────────────────────────────────────────────

function formatICSDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z')
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** Fold ICS lines to ≤75 octets per RFC 5545 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75))
    rest = ' ' + rest.slice(75)
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

function buildICS(item: Item): string {
  const uid      = `aggiemap-${item.id}@aggiemap.app`
  const dtstart  = formatICSDate(item.start_time!)
  const dtend    = item.end_time ? formatICSDate(item.end_time) : dtstart
  const dtstamp  = formatICSDate(new Date().toISOString())
  const location = [item.location_name, item.address].filter(Boolean).join(', ')

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NearU//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    foldLine(`SUMMARY:${escapeICS(item.title)}`),
  ]

  if (item.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeICS(item.description)}`))
  }
  if (location) {
    lines.push(foldLine(`LOCATION:${escapeICS(location)}`))
  }
  if (item.external_link) {
    lines.push(foldLine(`URL:${item.external_link}`))
  }
  if (item.latitude && item.longitude) {
    lines.push(`GEO:${item.latitude};${item.longitude}`)
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = getServerSupabase()
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const item = data as Item

  if (!item.start_time) {
    return NextResponse.json(
      { error: 'This listing does not have an event time.' },
      { status: 400 },
    )
  }

  const ics      = buildICS(item)
  const filename = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) + '.ics'

  return new NextResponse(ics, {
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}
