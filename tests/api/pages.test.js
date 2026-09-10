import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { PAGES, rewriteLink, renderMarkdown, loadPage } from '../../src/api/pages.js'
import { renderDocPage } from '../../src/api/render.js'
import { createServer } from '../../src/api/server.js'

/**
 * The prose pages are the repository's own Markdown, served in the site's
 * chrome. One copy, so the terms a contributor agrees to and the terms in the
 * repository cannot drift — which for a document with legal effect matters more
 * than the convenience of a separate template.
 */

describe('the served pages', () => {
  it('names files that exist', () => {
    for (const [route, page] of Object.entries(PAGES)) {
      expect(fs.existsSync(page.file), `${route} → ${page.file}`).toBe(true)
    }
  })

  it('serves the address the crawler user agent promises', async () => {
    // config/preferences.js sends this on every outbound harvest request, so it
    // is a promise already made to every source that has seen one.
    const { HARVEST_CONFIG } = await import('../../config/preferences.js')
    const promised = HARVEST_CONFIG.userAgent.match(/\+(https?:\/\/[^)]+)/)[1]
    const path = new URL(promised).pathname
    expect(Object.keys(PAGES)).toContain(path)
  })

  it('is dispatched from PAGES, not from a second list of its keys', () => {
    // The route handler used to enumerate '/about', '/terms', '/about/crawler'
    // in a switch. Adding a page then meant editing two places, and the route
    // is the one that gets forgotten — the recurring failure in CLAUDE.md.
    const server = fs.readFileSync('src/api/server.js', 'utf8')
    expect(server, 'server.js dispatches prose pages from PAGES').toMatch(/if \(PAGES\[path\]\)/)
    for (const route of Object.keys(PAGES)) {
      expect(server, `server.js still names ${route} in a case label`).not.toContain(`case '${route}'`)
    }
  })

  it('is a whitelist, not a directory', () => {
    // "Render whatever is under docs/" would publish the mistake log and the
    // implementation plan the moment someone guessed a filename.
    for (const page of Object.values(PAGES)) {
      expect(page.file.startsWith('docs/')).toBe(true)
      expect(page.file).not.toContain('..')
    }
    expect(Object.values(PAGES).map(p => p.file)).not.toContain('docs/plan.md')
  })
})

describe('inter-document links', () => {
  it('rewrites a sibling document to its route', () => {
    expect(rewriteLink('about.md')).toBe('/about')
    expect(rewriteLink('contributor-terms.md')).toBe('/terms')
    expect(rewriteLink('crawler.md')).toBe('/about/crawler')
  })

  it('keeps a fragment', () => {
    expect(rewriteLink('contributor-terms.md#3-withdrawal')).toBe('/terms#3-withdrawal')
  })

  it('sends an unserved document to the repository rather than nowhere', () => {
    // A broken link in the terms is worse than an off-site one.
    expect(rewriteLink('resources.md')).toMatch(/^https:\/\/github\.com\/.*resources\.md$/)
  })

  it('leaves absolute links, mailto and anchors alone', () => {
    expect(rewriteLink('https://example.invalid/x')).toBe('https://example.invalid/x')
    expect(rewriteLink('mailto:someone@example.invalid')).toBe('mailto:someone@example.invalid')
    expect(rewriteLink('#section')).toBe('#section')
    expect(rewriteLink('/plugin/x')).toBe('/plugin/x')
  })
})

describe('rendering', () => {
  it('gives headings ids, so a clause can be cited', () => {
    const html = renderMarkdown('## 3. Withdrawal, and what it cannot do\n')
    expect(html).toContain('id="3-withdrawal-and-what-it-cannot-do"')
  })

  it('does not collide two identical headings onto one id', () => {
    const html = renderMarkdown('## Contact\n\ntext\n\n## Contact\n')
    expect(html).toContain('id="contact"')
    expect(html).toContain('id="contact-1"')
  })

  it('renders tables and fenced code, which these documents use', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n')).toContain('<table>')
    expect(renderMarkdown('```sh\nls\n```\n')).toContain('<pre>')
  })

  it('leaves no unresolved relative link in any served page', async () => {
    for (const path of Object.keys(PAGES)) {
      const page = await loadPage(path, process.cwd())
      const hrefs = [...page.html.matchAll(/href="([^"]*)"/g)].map(m => m[1])
      const broken = hrefs.filter(h => !/^(https?:|mailto:|\/|#)/.test(h))
      expect(broken, `${path} has unresolved links`).toEqual([])
    }
  })
})

describe('the page in the site chrome', () => {
  it('carries the site header, footer and the page title', async () => {
    const page = await loadPage('/terms', process.cwd())
    const html = renderDocPage(page)
    expect(html).toContain('<title>Contributor terms — Plugin Universe</title>')
    expect(html).toContain('Plugin Universe</a></h1>')
    expect(html).toContain('href="/about"')
    expect(html).toContain('class="prose"')
  })

  it('refuses to start when a page source is missing', () => {
    // This was a 500 on three routes in production, from docs/ being in
    // .dockerignore while the app served pages out of it. A container that
    // will not start is far easier to notice than one quietly broken in one
    // corner, so the check moved from per-request to startup.
    const search = { documents: new Map(), index: { size: 0 }, facets: async () => ({}) }
    expect(() => createServer({ search, config: null, projectRoot: '/nonexistent' }))
      .toThrow(/missing their source files/)
  })

  it('returns null for a path it does not serve', async () => {
    expect(await loadPage('/docs/plan.md', process.cwd())).toBeNull()
    expect(await loadPage('/etc/passwd', process.cwd())).toBeNull()
  })
})
