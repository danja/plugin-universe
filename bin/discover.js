#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/Config.js'
import GitHubClient from '../src/harvest/GitHubClient.js'
import GitHubDiscovery, { DEFAULT_TOPICS } from '../src/harvest/GitHubDiscovery.js'

/**
 * Find candidate GitHub repositories and write them out for review.
 *
 * This writes a file. It ingests nothing. The separation is the point: which
 * repositories to harvest is a curation decision with a written answer, and the
 * answer lives in a file a person can read, edit and commit — not in whatever a
 * search query returned on the day.
 *
 * Rows are marked `include: true` only when the repository states a licence the
 * graph registry recognises as redistributable. An unlicensed repository is not
 * excluded because it is bad; it is excluded because silence is not permission,
 * and harvesting it would add data the public dump could never use. Flip the
 * flag by hand once you have an answer.
 *
 * Usage:
 *   node bin/discover.js
 *   node bin/discover.js --topics lv2,clap-plugin --limit 400
 *   node bin/discover.js --out data/curation/github-candidates.json --merge
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}

const outPath = flag('out') ?? 'data/curation/github-candidates.json'
const limit = Number(flag('limit') ?? 200)
const maxPages = Number(flag('pages') ?? 2)
const topics = (flag('topics') ?? DEFAULT_TOPICS.join(',')).split(',').map(t => t.trim()).filter(Boolean)
const merge = args.includes('--merge')

const config = Config.load()
const client = GitHubClient.fromEnvironment({
  cacheDir: path.join(Config.projectRoot, 'data/cache/github')
})

if (!client.authenticated) {
  console.error(
    'No GITHUB_TOKEN in .env. Unauthenticated discovery is limited to 60 requests an hour and\n' +
    'the search endpoint to 10 a minute, which is not enough to be either useful or polite.\n' +
    'See .env.example — the token needs no scopes at all.'
  )
  process.exit(1)
}

console.log(`Searching topics: ${topics.join(', ')}`)
const discovery = new GitHubDiscovery(client)
const found = await discovery.discover(topics, { limit, maxPages })

// Preserve decisions already made. A re-run must not silently revert an
// include flag someone set deliberately after reading the terms.
let rows = found
if (merge && fs.existsSync(outPath)) {
  const existing = JSON.parse(await fs.promises.readFile(outPath, 'utf8'))
  const decisions = new Map(existing.candidates.map(row => [`${row.owner}/${row.repo}`, row]))
  rows = found.map(row => {
    const previous = decisions.get(`${row.owner}/${row.repo}`)
    if (!previous) return row
    // Keep the human decision; refresh everything the API is authoritative for.
    return { ...row, include: previous.include, note: previous.note ?? undefined }
  })
  for (const [name, previous] of decisions) {
    if (!rows.some(row => `${row.owner}/${row.repo}` === name)) rows.push(previous)
  }
}

const included = rows.filter(row => row.include)
const unlicensed = rows.filter(row => row.licence === 'unknown')

// A candidate list nobody can read is not a review step. When the output
// directory is bind-mounted from the host, it has to be writable by the uid
// this process runs as — say so plainly rather than surfacing a bare EACCES.
try {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
const write = body => fs.promises.writeFile(outPath, body, 'utf8').catch(error => {
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(
      `\nCannot write ${outPath}: permission denied, running as uid ${process.getuid?.() ?? '?'}.\n` +
      'If this is a bind mount from the host, give it to that uid:\n' +
      `  sudo chown -R ${process.getuid?.() ?? 1001}:${process.getgid?.() ?? 1001} data/curation`
    )
    process.exit(1)
  }
  throw error
})

await write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  topics,
  site: config.get('site.domain'),
  counts: { found: rows.length, included: included.length, unlicensed: unlicensed.length },
  candidates: rows
}, null, 2))

console.log(`\n${rows.length} repositories → ${outPath}`)
console.log(`  ${included.length} marked include`)
console.log(`  ${unlicensed.length} with no recognised licence — review these by hand`)
console.log(`  API requests used this run: ${client.rateLimit.used}`)
if (client.rateLimit.remaining !== null) {
  console.log(`  rate limit remaining: ${client.rateLimit.remaining}/${client.rateLimit.limit}`)
}

const byLicence = new Map()
for (const row of rows) byLicence.set(row.licence, (byLicence.get(row.licence) ?? 0) + 1)
console.log('\nlicences:')
for (const [licence, count] of [...byLicence].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${licence}`)
}

console.log('\nReview the file, then harvest with:')
console.log(`  node bin/ingest.js --github ${outPath} --skip-embeddings`)
