import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Where a local source checkout (downspout, flues, jigdaw) lives.
 *
 * In order: the source's own variable (`JIGDAW_PATH`), then `SEED_DIR/<name>`
 * (the variable docker-compose and docs/deployment.md already use for the
 * parent directory), then the checkout beside this repository. The last is
 * derived, not guessed: on the dev machine and on the server the sources are
 * cloned next to plugin-universe, so one rule serves `/home/danny/github` and
 * `/home/github` without either being written into the code.
 *
 * A path that does not exist is an error naming what was tried, rather than a
 * fallback to somewhere else.
 */
export function seedCandidates (name) {
  return [
    process.env[`${name.toUpperCase()}_PATH`] || null,
    process.env.SEED_DIR ? path.join(process.env.SEED_DIR, name) : null,
    path.join(path.dirname(fs.realpathSync(repoRoot)), name)
  ].filter(Boolean)
}

/**
 * The first candidate that exists, or the first candidate when none does —
 * for a caller (bin/ingest.js) that reports a missing checkout itself.
 */
export function seedPathOrFirst (name) {
  const candidates = seedCandidates(name)
  return candidates.find(c => fs.existsSync(c)) ?? candidates[0]
}

export function seedPath (name) {
  const tried = []
  for (const candidate of seedCandidates(name)) {
    if (fs.existsSync(candidate)) return candidate
    tried.push(candidate)
  }
  throw new Error(
    `No ${name} checkout. Tried ${tried.join(', ')}. ` +
    `Set ${name.toUpperCase()}_PATH, or SEED_DIR to the directory holding the checkouts.`
  )
}

export default seedPath
