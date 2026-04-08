import { Category } from './types'

export const CATEGORIES: Category[] = [
  {
    slug: 'events',
    label: 'Events',
    subtitle: 'Things happening around Davis',
    icon: '📅',
    subcategories: [
      { slug: 'sports', label: 'Sports' },
      { slug: 'club-student-org', label: 'Club / Student Org' },
      { slug: 'social-party', label: 'Social / Party' },
      { slug: 'academic-lecture', label: 'Academic / Lecture' },
      { slug: 'career-networking', label: 'Career / Networking' },
      { slug: 'arts-music', label: 'Arts / Music' },
      { slug: 'volunteer', label: 'Volunteer' },
    ],
  },
  {
    slug: 'food',
    label: 'Food',
    subtitle: 'Cafes, restaurants, desserts',
    icon: '🍜',
    subcategories: [
      { slug: 'restaurant', label: 'Restaurant' },
      { slug: 'cafe', label: 'Cafe' },
      { slug: 'dessert', label: 'Dessert' },
      { slug: 'cheap-eats', label: 'Cheap Eats' },
    ],
  },
  {
    slug: 'outdoor',
    label: 'Outdoor',
    subtitle: 'Parks, trails, scenic spots',
    icon: '🌿',
    subcategories: [
      { slug: 'parks', label: 'Parks' },
      { slug: 'trails', label: 'Trails' },
      { slug: 'scenic-spots', label: 'Scenic Spots' },
    ],
  },
  {
    slug: 'study',
    label: 'Study',
    subtitle: 'Study spots and work-friendly places',
    icon: '📚',
    subcategories: [
      { slug: 'library', label: 'Library' },
      { slug: 'cafe-study-spots', label: 'Cafe Study Spots' },
      { slug: 'quiet-spaces', label: 'Quiet Spaces' },
      { slug: 'group-study', label: 'Group Study' },
    ],
  },
  {
    slug: 'shopping',
    label: 'Shopping',
    subtitle: 'Local stores and markets',
    icon: '🛍',
    subcategories: [
      { slug: 'grocery', label: 'Grocery' },
      { slug: 'fashion', label: 'Fashion' },
      { slug: 'local-shops', label: 'Local Shops' },
      { slug: 'weekend-market', label: 'Weekend Market' },
    ],
  },
  {
    slug: 'campus',
    label: 'Campus',
    subtitle: 'Activities, events, and resources',
    icon: '🎓',
    subcategories: [
      { slug: 'student-services', label: 'Student Services' },
      { slug: 'campus-events', label: 'Campus Events' },
      { slug: 'resource-centers', label: 'Resource Centers' },
      { slug: 'department-activities', label: 'Department Activities' },
    ],
  },
]

export const PREDEFINED_TAGS = [
  'free',
  'paid',
  'student-friendly',
  'indoor',
  'outdoor',
  'weekend',
  'beginner-friendly',
  'networking',
  'music',
  'sports',
  'food',
  'academic',
]

export const QUICK_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'Free', value: 'free' },
  { label: 'Outdoor', value: 'outdoor' },
  { label: 'Student-Friendly', value: 'student-friendly' },
]

export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug)
}

export function getSubcategoryLabel(categorySlug: string, subcategorySlug: string): string {
  const category = getCategoryBySlug(categorySlug)
  const sub = category?.subcategories.find((s) => s.slug === subcategorySlug)
  return sub?.label ?? subcategorySlug
}
