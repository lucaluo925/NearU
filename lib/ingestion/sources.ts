/**
 * Aggie Map — Ingestion Source Registry
 *
 * Central config for all event ingestion sources.
 * Edit `enabled` to disable a source without touching parser code.
 * `reliability` reflects last observed real-world status.
 *
 * Used by:
 *  - app/api/cron/ingest/route.ts   (daily cron)
 *  - app/api/admin/discover/route.ts (candidate discovery)
 */

export type SourceType     = 'rss' | 'ics' | 'json-ld' | 'html'
export type SourceReliability = 'healthy' | 'weak' | 'broken' | 'blocked'

export interface IngestionSource {
  id:          string            // matches source_type in items table
  name:        string
  type:        SourceType
  url:         string
  enabled:     boolean
  priority:    number            // lower = runs first
  timeout:     number            // fetch timeout ms
  reliability: SourceReliability // last observed status
  notes:       string
}

export const SOURCES: IngestionSource[] = [
  // ── Active / healthy ──────────────────────────────────────────────────────────
  {
    id:          'ucd-library',
    name:        'UC Davis Library',
    type:        'rss',
    url:         'https://events.library.ucdavis.edu/calendar/1.xml',
    enabled:     true,
    priority:    1,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'Localist RSS feed. Reliable. ~20 campus events per run.',
  },
  {
    id:          'mondavi',
    name:        'Mondavi Center for the Performing Arts',
    type:        'html',
    url:         'https://www.mondaviarts.org/whats-on/',
    enabled:     true,
    priority:    2,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'c-event-card HTML with ISO datetime attribute. ~12 events per run.',
  },
  {
    id:          'davis-downtown',
    name:        'Davis Downtown',
    type:        'ics',
    url:         'https://davisdowntown.com/events/?ical=1',
    enabled:     true,
    priority:    3,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'The Events Calendar ICS. ~30 downtown Davis events per run.',
  },
  {
    id:          'eventbrite-davis',
    name:        'Eventbrite — Davis, CA',
    type:        'json-ld',
    url:         'https://www.eventbrite.com/d/ca--davis/events/',
    enabled:     true,
    priority:    4,
    timeout:     25_000,
    reliability: 'healthy',
    notes:       'JSON-LD ItemList on search results page. ~24 Davis-area events per run.',
  },
  {
    id:          'visit-davis',
    name:        'Visit Davis',
    type:        'ics',
    url:         'https://visitdavis.org/events-calendar/?ical=1',
    enabled:     true,
    priority:    5,
    timeout:     20_000,
    reliability: 'weak',
    notes:       'The Events Calendar ICS. Small feed (~4 events). Tourism-focused.',
  },
  {
    id:          'ucd-website',
    name:        'UC Davis Main Events',
    type:        'html',
    url:         'https://www.ucdavis.edu/events',
    enabled:     true,
    priority:    6,
    timeout:     20_000,
    reliability: 'weak',
    notes:       'Drupal SiteFarm HTML. Inconsistent — mainly promotional activities. Kept as supplement.',
  },
  // ── New sources (2026-04-02 expansion) ───────────────────────────────────────
  {
    id:          'ucd-athletics',
    name:        'UC Davis Aggies Athletics',
    type:        'ics',
    url:         'https://ucdavisaggies.com/calendar.ashx?type=ics',
    enabled:     true,
    priority:    7,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'Sidearm Sports ICS (ucdavisaggies.com, NOT ucdavis.edu — not WAF-blocked). All Aggie sports.',
  },
  {
    id:          'river-cats',
    name:        'Sacramento River Cats (MiLB)',
    type:        'ics',
    url:         'https://www.milb.com/sacramento/schedule/ical',
    enabled:     true,
    priority:    7,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'MiLB iCalendar season schedule. ~70 home + away games. Sports diversity.',
  },
  {
    id:          'old-sacramento',
    name:        'Old Sacramento Waterfront',
    type:        'ics',
    url:         'https://www.oldsacramento.com/events/?ical=1',
    enabled:     true,
    priority:    8,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'The Events Calendar ICS (same as Davis Downtown). Falls back to JSON-LD if ICS empty.',
  },
  {
    id:          'crocker-museum',
    name:        'Crocker Art Museum',
    type:        'json-ld',
    url:         'https://www.crockerart.org/events/',
    enabled:     true,
    priority:    7,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       '__NEXT_DATA__ JSON (Contentful/Tessitura backend). 75+ events per run. Sacramento cultural anchor.',
  },
  {
    id:          'woodland-city',
    name:        'City of Woodland — Public Calendar',
    type:        'ics',
    url:         'https://www.cityofwoodland.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar',
    enabled:     true,
    priority:    8,
    timeout:     20_000,
    reliability: 'healthy',
    notes:       'CivicPlus iCalendar feed. Official Woodland city events. Geographic diversity.',
  },
  {
    id:          'meetup-sacramento',
    name:        'Meetup — Sacramento Area',
    type:        'json-ld',
    url:         'https://www.meetup.com/find/?location=Sacramento%2C+CA&source=EVENTS',
    enabled:     true,
    priority:    9,
    timeout:     25_000,
    reliability: 'healthy',
    notes:       'JSON-LD @type:Event blocks. In-person events only. Tech, social, community meetups.',
  },
  {
    id:          'visit-yolo',
    name:        'Visit Yolo County',
    type:        'json-ld',
    url:         'https://www.visityoloco.com/events/',
    enabled:     true,
    priority:    10,
    timeout:     20_000,
    reliability: 'weak',
    notes:       'JSON-LD events on Yolo County tourism site. Small feed, county-wide coverage.',
  },
  // ── WAF-blocked (disabled) ────────────────────────────────────────────────────
  {
    id:          'ucd-arboretum',
    name:        'UC Davis Arboretum',
    type:        'html',
    url:         'https://arboretum.ucdavis.edu/events',
    enabled:     false,
    priority:    99,
    timeout:     10_000,
    reliability: 'blocked',
    notes:       'Blocked by UC Davis WAF (Cloudflare, HTTP 403). No RSS/ICS available.',
  },
  {
    id:          'manetti-shrem',
    name:        'Manetti Shrem Museum of Art',
    type:        'html',
    url:         'https://manettishremmuseum.ucdavis.edu/events',
    enabled:     false,
    priority:    99,
    timeout:     10_000,
    reliability: 'blocked',
    notes:       'Redirects to ucdavis.edu subdomain — blocked by UC Davis WAF (HTTP 403).',
  },
  {
    id:          'ucd-student-affairs',
    name:        'UC Davis Student Affairs',
    type:        'rss',
    url:         'https://studentaffairs.ucdavis.edu/events.rss',
    enabled:     false,
    priority:    99,
    timeout:     10_000,
    reliability: 'blocked',
    notes:       'Blocked by UC Davis WAF (HTTP 403). All *.ucdavis.edu subdomains blocked server-side.',
  },
]

/** Returns enabled sources sorted by priority */
export function getEnabledSources(): IngestionSource[] {
  return SOURCES.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority)
}

/** Returns disabled sources (for documentation / discovery UI) */
export function getDisabledSources(): IngestionSource[] {
  return SOURCES.filter((s) => !s.enabled)
}
