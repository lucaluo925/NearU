import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = readFileSync('/Users/luca/Desktop/fair-division-lab/.claude/worktrees/sharp-yonath/davis-explorer/.env.local', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
const supabase = createClient(url, key)

const { data } = await supabase.from('items').select('id,title,address,latitude,longitude,location_name').is('deleted_at', null).order('created_at', { ascending: false }).limit(200)

console.log(`Total items: ${data.length}`)
console.log('\n--- Address distribution ---')
const addrCount = {}
data.forEach(r => { addrCount[r.address] = (addrCount[r.address] || 0) + 1 })
Object.entries(addrCount).sort((a,b) => b[1]-a[1]).forEach(([addr, n]) => console.log(`  ${n}x "${addr}"`))

console.log('\n--- Items missing coords ---')
const noCoords = data.filter(r => r.latitude == null || r.longitude == null)
console.log(`  ${noCoords.length} items missing lat/lng:`)
noCoords.forEach(r => console.log(`  - "${r.title}" addr="${r.address}" loc="${r.location_name}"`))

console.log('\n--- Sample campus items with generic addresses ---')
const generic = data.filter(r => r.address?.includes('Shields Ave'))
console.log(`  ${generic.length} items with "Shields Ave" address`)
generic.slice(0, 8).forEach(r => console.log(`  - "${r.title}" | loc="${r.location_name}" | ${r.latitude},${r.longitude}`))
