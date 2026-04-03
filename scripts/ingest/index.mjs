#!/usr/bin/env node
/**
 * Aggie Map — Event Ingestion Pipeline
 *
 * Usage:
 *   node scripts/ingest/index.mjs [source]
 *
 * Sources:
 *   ucd        → UC Davis main events page (ucdavis.edu/events)
 *   library    → UC Davis Library (Localist RSS feed)
 *   arboretum  → UC Davis Arboretum events page
 *   local      → Curated places/events from places.json
 *   all        → All sources (default)
 *
 * npm scripts:
 *   npm run ingest              → all sources
 *   npm run ingest:ucd          → UC Davis main only
 *   npm run ingest:local        → local sources only
 */

import { log } from './lib/logger.mjs'
import { upsertItems } from './lib/upsert.mjs'
import { fetchUCDEvents } from './sources/ucd.mjs'
import { fetchLibraryEvents } from './sources/ucd-library.mjs'
import { fetchArboretumEvents } from './sources/arboretum.mjs'
import { fetchLocalEvents } from './sources/local.mjs'

const source = process.argv[2] ?? 'all'
const start  = Date.now()

log.section(`Aggie Map Ingestion — source: ${source}`)

// Per-source stats for structured output
const sourceStats = {}
const summary = { inserted: 0, updated: 0, skipped: 0, failed: 0 }

async function runSource(name, sourceType, fetchFn) {
  const stat = { fetched: 0, parsed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 }
  sourceStats[name] = stat

  log.section(name)
  try {
    const items = await fetchFn()
    stat.fetched = items.length
    stat.parsed  = items.length

    log.info(`Processing ${items.length} items from ${name}...`)
    const result = await upsertItems(items, sourceType)

    stat.inserted = result.inserted
    stat.updated  = result.updated
    stat.skipped  = result.skipped
    stat.failed   = result.failed

    summary.inserted += result.inserted
    summary.updated  += result.updated
    summary.skipped  += result.skipped
    summary.failed   += result.failed

    log.info(`${name} done: +${result.inserted} inserted, ~${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`)
  } catch (err) {
    log.error(`${name} source failed: ${err.message}`)
    stat.failed++
    summary.failed++
  }
}

const VALID_SOURCES = ['ucd', 'library', 'arboretum', 'local', 'all']

if (!VALID_SOURCES.includes(source)) {
  log.error(`Unknown source: "${source}". Use: ${VALID_SOURCES.join(' | ')}`)
  process.exit(1)
}

// Run sources — each wrapped independently so one failure doesn't kill others
if (source === 'ucd' || source === 'all') {
  await runSource('UC Davis Main', 'ucd-website', fetchUCDEvents)
}

if (source === 'library' || source === 'all') {
  await runSource('UC Davis Library', 'ucd-library', fetchLibraryEvents)
}

if (source === 'arboretum' || source === 'all') {
  await runSource('UC Davis Arboretum', 'ucd-arboretum', fetchArboretumEvents)
}

if (source === 'local' || source === 'all') {
  await runSource('Local Sources', 'local', fetchLocalEvents)
}

// ── Structured summary ───────────────────────────────────────────────────────
const elapsed = ((Date.now() - start) / 1000).toFixed(1)
log.section('Summary')

// Per-source breakdown
for (const [name, stat] of Object.entries(sourceStats)) {
  console.log(`  ${name.padEnd(22)}: fetched=${stat.fetched} parsed=${stat.parsed} inserted=${stat.inserted} updated=${stat.updated} skipped=${stat.skipped} failed=${stat.failed}`)
}
console.log()
console.log(`  Total Inserted : ${summary.inserted}`)
console.log(`  Total Updated  : ${summary.updated}`)
console.log(`  Total Skipped  : ${summary.skipped}`)
console.log(`  Total Failed   : ${summary.failed}`)
console.log(`  Time           : ${elapsed}s`)
console.log()

if (summary.failed > 0) process.exit(1)
