import type { Metadata } from 'next'
import ForYouClient from './ForYouClient'

export const metadata: Metadata = {
  title:       'For You — NearU',
  description: 'Personalized picks based on what you like.',
}

export default function ForYouPage() {
  return <ForYouClient />
}
