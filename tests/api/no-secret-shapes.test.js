import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Nothing in this repository may *look* like a leaked credential.
 *
 * A real secret must never be committed, and `.env` is gitignored so that it
 * cannot be. This guard is about the other half, which is not the same problem:
 * a string that only resembles a key. A webhook signing secret spelling out
 * "test secret for testing only" was invented for `tests/api/billing.test.js`,
 * valid in no Stripe account anywhere, and GitHub's push protection flagged it
 * — because a scanner matches a prefix and the run of characters after it, and
 * has no way to tell an invention from the real thing.
 *
 * The cost is not the alert. It is that somebody has to read it, decide it is
 * false, and dismiss it — and the second time they do that they stop reading
 * the next one carefully. A credential warning is only worth having if every
 * one of them is worth acting on, so a fixture that spends that attention has
 * to be written differently rather than dismissed.
 *
 * Differently means assembled: `key('sk_test')` in billing.test.js builds the
 * string at run time from a prefix that matches nothing on its own. The code
 * under test sees exactly what it saw before; the file at rest contains no
 * candidate. Comments and prose count too, which is why the paragraph above
 * describes that fixture rather than quoting it — the first draft of this file
 * quoted it, and was caught by its own check.
 */

const ROOT = path.resolve('.')

/** Directories never walked: not ours, not text, or not in git. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vitest-cache', 'coverage', 'dist',
  // Runtime state: harvested bundles, uploaded images, the TDB2 store.
  'data', 'cache'
])

/** Files never read: gitignored secrets, and anything that is not text. */
const SKIP_FILES = new Set(['.env', 'package-lock.json'])
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf',
  '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.so', '.wasm', '.bin'
])

/**
 * The shapes a scanner reads as a credential.
 *
 * Each is deliberately a little looser than the published pattern it stands
 * for — GitHub tightens and loosens these without telling anyone, and the point
 * here is that nothing in the repository comes close, not that we reproduce
 * somebody's regex. Add a row when a new provider's key could plausibly be
 * pasted into a fixture.
 */
const SHAPES = Object.freeze([
  { name: 'a Stripe API key', pattern: /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{8,}/ },
  { name: 'a Stripe webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9]{12,}/ },
  { name: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { name: 'an AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{20,}/ },
  { name: 'a Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'an OpenAI-style key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/ },
  { name: 'a private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ }
])

function textFiles (dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...textFiles(full))
    } else if (!SKIP_FILES.has(name) && !SKIP_EXTENSIONS.has(path.extname(name))) {
      out.push(full)
    }
  }
  return out
}

describe('nothing in the repository reads as a leaked credential', () => {
  const offenders = []
  for (const file of textFiles(ROOT).sort()) {
    const relative = path.relative(ROOT, file)
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    source.split('\n').forEach((text, index) => {
      for (const { name, pattern } of SHAPES) {
        if (pattern.test(text)) offenders.push(`${relative}:${index + 1}  looks like ${name}`)
      }
    })
  }

  it('finds files to check', () => {
    // The failure this guard is most likely to suffer: a skip list that grows
    // until it is scanning nothing, and reports clean for ever.
    expect(textFiles(ROOT).length).toBeGreaterThan(100)
  })

  it('has no line that a secret scanner would flag', () => {
    expect(offenders, [
      'Each of these will raise a push-protection alert, whether or not it is a',
      'real credential. If it is real: rotate it, and get it out of the history.',
      'If it is a test fixture: assemble it at run time from its prefix, as',
      'tests/api/billing.test.js does with key(). Prose and comments count.',
      ''
    ].join('\n')).toEqual([])
  })

  it('would notice if the detector stopped detecting', () => {
    // Built the same way the fixtures are, so that demonstrating the guard does
    // not trip it. A guard that scrapes source and finds nothing is
    // indistinguishable from one that has gone blind.
    const samples = [
      'sk_live' + '_' + 'A'.repeat(30),
      'whsec' + '_' + 'b'.repeat(32),
      'ghp' + '_' + 'C'.repeat(36),
      'AKIA' + 'D'.repeat(16),
      'AIza' + 'e'.repeat(35),
      'xoxb-' + '1'.repeat(12) + '-abc',
      'sk-' + 'F'.repeat(32),
      '-----BEGIN RSA PRIVATE' + ' KEY-----'
    ]
    for (const sample of samples) {
      expect(SHAPES.some(shape => shape.pattern.test(sample)), sample.slice(0, 12)).toBe(true)
    }
  })

  it('does not flag the prefixes on their own', () => {
    // `expect(published).not.toContain('sk_test')` is a legitimate assertion and
    // must stay writable; a guard that forbids the word rather than the shape
    // would be worked around rather than obeyed.
    for (const harmless of ['sk_test', 'whsec', 'pk_live_x', 'cs_test_1', 'price_promoted']) {
      expect(SHAPES.some(shape => shape.pattern.test(harmless)), harmless).toBe(false)
    }
  })
})
