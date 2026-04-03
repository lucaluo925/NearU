import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase storage (user-uploaded flyers)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // UC Davis domains
      { protocol: 'https', hostname: '*.ucdavis.edu' },
      // Azure CDN (UCD Library localist images)
      { protocol: 'https', hostname: '*.azureedge.net' },
      // Contentful CDN (Mondavi Arts, and any site using Contentful CMS)
      { protocol: 'https', hostname: '*.ctfassets.net' },
      // Mondavi Arts
      { protocol: 'https', hostname: 'mondaviarts.org' },
      { protocol: 'https', hostname: '*.mondaviarts.org' },
      // Crocker Art Museum
      { protocol: 'https', hostname: 'crockerart.org' },
      { protocol: 'https', hostname: '*.crockerart.org' },
      // Old Sacramento
      { protocol: 'https', hostname: 'oldsacramento.com' },
      { protocol: 'https', hostname: '*.oldsacramento.com' },
      // Visit Yolo
      { protocol: 'https', hostname: 'visityoloco.com' },
      { protocol: 'https', hostname: '*.visityoloco.com' },
      // Davis Downtown
      { protocol: 'https', hostname: 'davisdowntown.com' },
      { protocol: 'https', hostname: '*.davisdowntown.com' },
      // Eventbrite
      { protocol: 'https', hostname: 'img.evbuc.com' },
      { protocol: 'https', hostname: '*.evbuc.com' },
    ],
  },
}

export default nextConfig
