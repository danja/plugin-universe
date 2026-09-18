import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Every relative link in a Markdown file points at a file that is there.
 *
 * Moving a document is the same failure as moving a route: `docs/danja-todo.md`
 * was referenced from TODO.md, CLAUDE.md, `docs/plan.md`, `docs/index.md`, two
 * nginx configurations and a comment in `src/billing/Billing.js`, and nothing
 * connected any of them to the file. Renaming it to HUMANS.md broke twenty-odd
 * links at once, every one of which would have read as fine to a careful
 * reviewer who was not chasing each in turn.
 *
 * It also catches the slower version: `docs/announcement-01.md` was deleted in
 * ae2aeb3 and the list that recommended reading it went on recommending it.
 *
 * Absolute URLs are somebody else's problem — checking them means a network
 * call, and a suite that fails when a third-party site is down is a suite
 * people learn to ignore. Site-absolute paths (`/services`) are routes, and
 * `linked-routes.test.js` is the guard for those.
 */

const SKIP = new Set(['node_modules', '.git', 'data', 'coverage', 'dist'])

/** Every Markdown file in the repository, excluding build output and state. */
function markdownFiles (dir = '.') {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...markdownFiles(full))
    else if (entry.name.endsWith('.md')) found.push(full)
  }
  return found
}

/**
 * The relative link targets in one file.
 *
 * A scheme is not a path: `[javascript:alert(1)](…)` appears in a worklog about
 * escaping untrusted Markdown, and treating it as a filename would fail the
 * suite over an example of the thing being described.
 */
function relativeLinks (text) {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => match[1])
    .filter(target => !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .filter(target => !target.startsWith('#') && !target.startsWith('/'))
    .map(target => target.split('#')[0])
    .filter(Boolean)
}

describe('links between documents', () => {
  const files = markdownFiles()

  it('finds documents to check', () => {
    // A guard that walks the tree can go blind rather than red: if this ever
    // finds nothing, every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(10)
  })

  it('finds links in them', () => {
    const total = files.reduce(
      (count, file) => count + relativeLinks(fs.readFileSync(file, 'utf8')).length, 0)
    expect(total).toBeGreaterThan(50)
  })

  it('resolves every one of them to a file that exists', () => {
    const broken = []
    for (const file of files) {
      for (const target of relativeLinks(fs.readFileSync(file, 'utf8'))) {
        const resolved = path.resolve(path.dirname(file), target)
        if (!fs.existsSync(resolved)) broken.push(`${file} → ${target}`)
      }
    }
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })
})

/**
 * The two lists a person is meant to work from live at the top level.
 *
 * They were `docs/todo-misc.md` and `docs/danja-todo.md`, which is where
 * something goes to be read by whoever is already in `docs/`. CLAUDE.md now
 * tells me to keep both current by name, so the name has to be the file.
 */
describe('the working lists', () => {
  it('are where CLAUDE.md says they are', () => {
    const claude = fs.readFileSync('CLAUDE.md', 'utf8')
    for (const name of ['HUMANS.md', 'INBOX.md']) {
      expect(fs.existsSync(name), `${name} is not at the repository root`).toBe(true)
    }
    expect(claude).toContain('HUMANS.md')
  })
})
