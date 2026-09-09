import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Every test file must be in a suite that runs it.
 *
 * The Vitest configurations list their directories explicitly, which keeps the
 * core suite fast and free of anything needing a live service. The cost is a
 * second place to edit: `tests/embeddings/` and `tests/profiler/` were each
 * written, committed, and silently never executed, because nothing connected a
 * new directory to the `include` list. The run went green and the file count
 * quietly did not go up.
 *
 * A test that does not run is worse than no test, because it reports as
 * coverage. This is the guard.
 *
 * It also refuses to let a `.test.js` sit in a directory no config names at all
 * — which is the same failure with the directory itself forgotten.
 */

const CONFIGS = ['vitest.core.config.js', 'vitest.store.config.js', 'vitest.live.config.js']

/** The `tests/<dir>/` prefixes a config's include globs cover. */
function coveredDirectories (configFile) {
  const source = fs.readFileSync(configFile, 'utf8')
  const include = source.match(/include:\s*\[([\s\S]*?)\]/)
  if (!include) throw new Error(`${configFile} has no include list`)
  return [...include[1].matchAll(/'tests\/([^/']+)\//g)].map(match => match[1])
}

/** Directories under tests/ that actually hold a test. */
function directoriesWithTests () {
  return fs.readdirSync('tests', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => fs.readdirSync(path.join('tests', entry.name))
      .some(file => file.endsWith('.test.js')))
    .map(entry => entry.name)
}

describe('the test suites cover every test', () => {
  const covered = new Set(CONFIGS.flatMap(coveredDirectories))
  const withTests = directoriesWithTests()

  it('finds tests to check', () => {
    expect(withTests.length).toBeGreaterThan(5)
  })

  it('runs every directory that contains a test', () => {
    const orphaned = withTests.filter(dir => !covered.has(dir))
    expect(
      orphaned,
      `tests/${orphaned.join('/, tests/')}/ contains tests that no Vitest config runs. ` +
      'Add it to vitest.core.config.js (no external services) or vitest.store.config.js (live services).'
    ).toEqual([])
  })

  it('names no directory that has gone away', () => {
    // The mirror image: a config listing a directory that no longer exists is
    // not an error in Vitest, it is silence, and it hides that the tests it
    // once ran are gone.
    const stale = [...covered].filter(dir => !fs.existsSync(path.join('tests', dir)))
    expect(stale, `a Vitest config includes tests/${stale.join('/, tests/')}/, which does not exist`)
      .toEqual([])
  })

  it('keeps the suites disjoint', () => {
    // The split is the point: core must stay runnable with nothing running,
    // and the live suite must not be reachable from a run that was meant to
    // stay on this machine.
    for (const [a, b] of [
      ['vitest.core.config.js', 'vitest.store.config.js'],
      ['vitest.core.config.js', 'vitest.live.config.js'],
      ['vitest.store.config.js', 'vitest.live.config.js']
    ]) {
      const first = new Set(coveredDirectories(a))
      const both = coveredDirectories(b).filter(dir => first.has(dir))
      expect(both, `tests/${both.join(', ')} is in both ${a} and ${b}`).toEqual([])
    }
  })

  it('keeps the live tests out of the catch-all configuration', () => {
    // vitest.config.js includes tests/**, which would sweep the live suite into
    // `npm run test:all` and fire requests at production from a local run.
    const config = fs.readFileSync('vitest.config.js', 'utf8')
    expect(config, 'vitest.config.js does not exclude tests/live/').toMatch(/exclude:[\s\S]*tests\/live/)
  })
})
