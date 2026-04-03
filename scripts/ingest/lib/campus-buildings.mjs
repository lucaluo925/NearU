/**
 * UC Davis campus building → address + coordinates mapping.
 *
 * Used by ingestion sources to resolve a raw location_name string
 * into a specific address and lat/lng, avoiding the generic
 * "1 Shields Ave" fallback that stacks all events at one map point.
 *
 * Usage:
 *   import { resolveCampusLocation } from './campus-buildings.mjs'
 *   const loc = resolveCampusLocation('Freeborn Hall')
 *   // → { address: 'Freeborn Hall, 1 Shields Ave, Davis, CA 95616', latitude: 38.5422, longitude: -121.7466 }
 */

/**
 * Each entry has:
 *   keys     - lowercase keywords; any key matching as a substring of the normalized input wins
 *   address  - canonical display/geocode address
 *   lat, lng - known coordinates (skips geocoding when provided)
 *
 * Keys are checked in order — put more-specific keys before general ones
 * within the same building group so the best match wins first.
 */
const BUILDINGS = [
  // ── ARC / Recreation ──────────────────────────────────────────────────────
  {
    keys: ['arc rock wall', 'rock wall', 'climbing wall'],
    address: 'UC Davis Activities & Recreation Center, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5429, lng: -121.7557,
  },
  {
    keys: ['arc courts', 'arc court', 'basketball court'],
    address: 'ARC Courts, UC Davis, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5432, lng: -121.7557,
  },
  {
    keys: ['arc pavilion', 'pavilion'],
    address: 'ARC Pavilion, UC Davis, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5437, lng: -121.7495,
  },
  {
    keys: ['arc ballroom'],
    address: 'UC Davis Activities & Recreation Center, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5429, lng: -121.7557,
  },
  {
    keys: ['activities & recreation', 'activities and recreation', ' arc ', 'arc,', 'arc.'],
    address: 'UC Davis Activities & Recreation Center, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5429, lng: -121.7557,
  },

  // ── Memorial Union ────────────────────────────────────────────────────────
  {
    keys: ['freeborn hall', 'freeborn'],
    address: 'Freeborn Hall, UC Davis, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5422, lng: -121.7466,
  },
  {
    keys: ['memorial union ballroom', 'mu ballroom', 'memorial union patio', 'mu patio',
           'memorial union', 'memorial union ', 'the coho', 'coffeehouse', 'coffee house'],
    address: 'Memorial Union, UC Davis, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5419, lng: -121.7486,
  },

  // ── Performing Arts ───────────────────────────────────────────────────────
  {
    keys: ['mondavi center', 'mondavi'],
    address: 'Mondavi Center for the Performing Arts, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5401, lng: -121.7516,
  },

  // ── Academic / Classroom Buildings ───────────────────────────────────────
  {
    keys: ['kemper hall', 'kemper'],
    address: 'Kemper Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5375, lng: -121.7491,
  },
  {
    keys: ['bainer hall', 'bainer'],
    address: 'Bainer Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5375, lng: -121.7503,
  },
  {
    keys: ['wellman hall', 'wellman'],
    address: 'Wellman Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5404, lng: -121.7476,
  },
  {
    keys: ['olson hall', 'olson'],
    address: 'Olson Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5415, lng: -121.7474,
  },
  {
    keys: ['hutchison hall', 'hutchison'],
    address: 'Hutchison Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5395, lng: -121.7467,
  },
  {
    keys: ['haring hall', 'haring'],
    address: 'Haring Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5417, lng: -121.7497,
  },
  {
    keys: ['hart hall', 'hart'],
    address: 'Hart Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5396, lng: -121.7460,
  },
  {
    keys: ['roessler hall', 'roessler'],
    address: 'Roessler Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5426, lng: -121.7494,
  },
  {
    keys: ['young hall', 'young'],
    address: 'Young Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5383, lng: -121.7439,
  },
  {
    keys: ['hunt hall', 'hunt'],
    address: 'Hunt Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5391, lng: -121.7451,
  },
  {
    keys: ['voorhies hall', 'voorhies'],
    address: 'Voorhies Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5430, lng: -121.7474,
  },
  {
    keys: ['social sciences', 'social science and humanities', 'ssh'],
    address: 'Social Sciences & Humanities, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5430, lng: -121.7460,
  },
  {
    keys: ['cruess hall', 'cruess'],
    address: 'Cruess Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5375, lng: -121.7513,
  },
  {
    keys: ['surge hall', 'surge'],
    address: 'Surge Building, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5380, lng: -121.7462,
  },
  {
    keys: ['walker hall', 'walker'],
    address: 'Walker Hall, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5427, lng: -121.7479,
  },

  // ── Administration & Services ─────────────────────────────────────────────
  {
    keys: ['mrak hall', 'mrak', 'admin building'],
    address: '1 Shields Ave, Davis, CA 95616',
    lat: 38.5382, lng: -121.7542,
  },
  {
    keys: ['king hall', 'school of law', 'law school'],
    address: 'King Hall School of Law, 400 Mrak Hall Dr, Davis, CA 95616',
    lat: 38.5382, lng: -121.7529,
  },
  {
    keys: ['north hall'],
    address: 'North Hall, UC Davis, Davis, CA 95616',
    lat: 38.5430, lng: -121.7482,
  },
  {
    keys: ['south hall'],
    address: 'South Hall, UC Davis, Davis, CA 95616',
    lat: 38.5415, lng: -121.7478,
  },

  // ── Student Life ─────────────────────────────────────────────────────────
  {
    keys: ['student community center', 'scc'],
    address: 'Student Community Center, UC Davis, Davis, CA 95616',
    lat: 38.5413, lng: -121.7468,
  },
  {
    keys: ['cross cultural center', 'ccc'],
    address: 'Cross Cultural Center, Kerr Hall, Davis, CA 95616',
    lat: 38.5432, lng: -121.7478,
  },
  {
    keys: ['lgbtqia', 'lgbtq resource'],
    address: 'LGBTQIA Resource Center, North Hall, Davis, CA 95616',
    lat: 38.5430, lng: -121.7482,
  },

  // ── Libraries ────────────────────────────────────────────────────────────
  {
    keys: ['shields library', 'shields'],
    address: 'Peter J. Shields Library, UC Davis, Davis, CA 95616',
    lat: 38.5403, lng: -121.7487,
  },
  {
    keys: ['bren hall', 'bren library', 'science library'],
    address: 'Bren Hall, UC Davis, Davis, CA 95616',
    lat: 38.5374, lng: -121.7502,
  },

  // ── Dining ───────────────────────────────────────────────────────────────
  {
    keys: ['silo'],
    address: 'The Silo, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5411, lng: -121.7494,
  },
  {
    keys: ['segundo dining', 'segundo'],
    address: 'Segundo Dining Commons, 320 College Park, Davis, CA 95616',
    lat: 38.5368, lng: -121.7531,
  },
  {
    keys: ['tercero dining', 'tercero'],
    address: 'Tercero Dining Commons, UC Davis, Davis, CA 95616',
    lat: 38.5330, lng: -121.7522,
  },

  // ── Outdoor / Sports ─────────────────────────────────────────────────────
  {
    keys: ['aggie soccer', 'soccer field'],
    address: 'Aggie Soccer Field, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5323, lng: -121.7555,
  },
  {
    keys: ['aggie stadium', 'toomey field'],
    address: 'UC Davis Health Stadium, 1 Garrod Dr, Davis, CA 95616',
    lat: 38.5478, lng: -121.7604,
  },
  {
    keys: ['hutchison field', 'track and field', 'track stadium'],
    address: 'Hutchison Field, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5380, lng: -121.7492,
  },
  {
    keys: ['rec hall', 'recreation hall'],
    address: 'Rec Hall, UC Davis, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5436, lng: -121.7491,
  },
  {
    keys: ['arboretum', 'putah creek'],
    address: 'UC Davis Arboretum, 448 La Rue Rd, Davis, CA 95616',
    lat: 38.5305, lng: -121.7536,
  },
  {
    keys: ['main quad', 'death valley', 'quad'],
    address: 'UC Davis Main Quad, 1 Shields Ave, Davis, CA 95616',
    lat: 38.5420, lng: -121.7484,
  },

  // ── Off-campus Davis venues ───────────────────────────────────────────────
  {
    keys: ['varsity theatre', 'varsity theater'],
    address: '616 2nd St, Davis, CA 95616',
    lat: 38.5451, lng: -121.7415,
  },
  {
    keys: ['central park davis', 'central park'],
    address: '4th St & C St, Davis, CA 95616',
    lat: 38.5459, lng: -121.7411,
  },
]

/**
 * Resolve a raw location name (from a scraped event) into a specific
 * campus address + coordinates.
 *
 * @param {string|null} rawName - The location_name from the event source
 * @returns {{ address: string, latitude: number, longitude: number } | null}
 */
export function resolveCampusLocation(rawName) {
  if (!rawName) return null

  // Normalize: lowercase, strip room numbers (e.g. "1065", "1130", "Rm 202"),
  // remove "UC Davis" prefix, collapse whitespace.
  const normalized = rawName
    .toLowerCase()
    .replace(/\brm\.?\s*\d+\w*\b/g, '')      // "Rm 202", "Rm. 1130"
    .replace(/\broom\s+\d+\w*\b/g, '')        // "Room 1065"
    .replace(/\b\d{3,4}[a-z]?\b/g, '')        // bare room codes like "1065", "1130"
    .replace(/\buc davis\b/gi, '')             // strip "UC Davis" prefix
    .replace(/[^a-z0-9&\s]/g, ' ')            // keep only alphanumeric, &, spaces
    .replace(/\s+/g, ' ')
    .trim()

  for (const building of BUILDINGS) {
    for (const key of building.keys) {
      if (normalized.includes(key)) {
        return {
          address: building.address,
          latitude: building.lat,
          longitude: building.lng,
        }
      }
    }
  }
  return null
}
