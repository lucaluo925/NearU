export type ItemStatus = 'pending' | 'approved' | 'rejected' | 'flagged'

export interface Item {
  id: string
  title: string
  category: string
  subcategory: string
  description?: string
  location_name?: string
  address: string
  city?: string
  region?: string
  latitude?: number
  longitude?: number
  start_time?: string
  end_time?: string
  external_link?: string
  flyer_image_url?: string
  source: string
  source_type?: string
  source_url?: string
  external_id?: string
  last_seen_at?: string
  tags: string[]
  created_by?: string
  created_at: string
  // Moderation fields (added in migration 001)
  status?: ItemStatus
  review_notes?: string | null
  reviewed_at?: string | null
  reviewed_by?: string | null
  risk_score?: number | null
  moderation_reason?: string | null
  // Computed at query time from reviews table
  avg_rating?: number | null
  review_count?: number
  // Food enrichment fields (migration 006)
  menu_link?: string | null
  known_for?: string[] | null
}

export interface Category {
  slug: string
  label: string
  subtitle: string
  icon: string
  subcategories: Subcategory[]
}

export interface Subcategory {
  slug: string
  label: string
}

export type ViewMode = 'grid' | 'list' | 'map'
export type SortMode = 'upcoming' | 'nearest' | 'newest' | 'top-rated' | 'popular' | 'best-nearby'
export type TimeFilter = 'today' | 'this-week' | null

export interface ItemWithDistance extends Item {
  distance_miles?: number
}

export const RADIUS_OPTIONS = [
  { label: '5 mi', value: 5 },
  { label: '20 mi', value: 20 },
  { label: '50 mi', value: 50 },
  { label: '100 mi', value: 100 },
] as const

export type RadiusMiles = typeof RADIUS_OPTIONS[number]['value']

/** UC Davis center coordinates */
export const UC_DAVIS_LAT = 38.5382
export const UC_DAVIS_LNG = -121.7617

export const REGION_OPTIONS = [
  { value: 'on-campus', label: 'On Campus' },
  { value: 'davis', label: 'Davis' },
  { value: 'woodland', label: 'Woodland' },
  { value: 'sacramento', label: 'Greater Sacramento' },
  { value: 'bay-area', label: 'Bay Area' },
  { value: 'other', label: 'Other' },
] as const

export type Region = typeof REGION_OPTIONS[number]['value']
