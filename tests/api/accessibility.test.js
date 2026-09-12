import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import {
  renderLandingPage, renderSearchPage, renderBrowsePage, renderPluginPage,
  renderCategoryPage, renderVendorPage, renderVendorsPage, renderSubmitPage,
  renderDocPage, renderAdminPage, renderContributionsPage, renderVocabularies
} from '../../src/api/render.js'
import { SUBMITTABLE } from '../../src/contrib/Submissions.js'
import { CORRECTABLE } from '../../src/contrib/Corrections.js'
import { ACTIONS } from '../../src/api/AdminActions.js'

/**
 * Accessibility, as a check rather than an intention.
 *
 * CLAUDE.md calls this a standing requirement, and a standing requirement that
 * nothing tests is a preference. The first deliberate pass found four things,
 * all of them absences rather than mistakes: no `<main>`, no skip link, no
 * focus style outside one control that happened to get noticed, and a search
 * box whose only name was a placeholder — which is a hint, not a label.
 *
 * Absences are exactly what a person building a page does not see. Hence this.
 */

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1234',
  name: 'Test Plugin', vendor: 'A Vendor', vendorSlug: 'a-vendor',
  description: 'Does a thing.', formats: ['VST3'], categories: ['reverb'],
  roles: [], tags: [], parameters: [], homepage: 'https://example.org/'
}

/** One of every page type a visitor can reach. */
const PAGES = {
  landing: () => renderLandingPage({ corpus: 1, results: [DOC], facetValues: {} }),
  search: () => renderSearchPage({ query: 'reverb', results: [DOC], total: 1, corpus: 1, elapsedMs: 3 }),
  browse: () => renderBrowsePage({ results: [DOC], total: 1, corpus: 1, offset: 0, limit: 10, facets: {} }),
  plugin: () => renderPluginPage(DOC),
  category: () => renderCategoryPage('reverb', [DOC], 1),
  vendor: () => renderVendorPage({
    slug: 'a-vendor', name: 'A Vendor', spellings: ['A Vendor'], count: 1, results: [DOC]
  }),
  vendors: () => renderVendorsPage([{ slug: 'a-vendor', name: 'A Vendor', count: 1 }]),
  submit: () => renderSubmitPage(SUBMITTABLE, { csrfToken: 't' }),
  doc: () => renderDocPage('About', '<p>Prose.</p>', {}),
  admin: () => renderAdminPage([], { csrfToken: 't', actions: ACTIONS }),
  contributions: () => renderContributionsPage([], { correctable: CORRECTABLE }),
  vocabularies: () => renderVocabularies({ pu: { description: 'Terms.', file: 'x.ttl' } }, {})
}

describe('every page a visitor can reach', () => {
  const rendered = Object.entries(PAGES).map(([name, render]) => [name, render()])

  it('declares its language', () => {
    // A screen reader picks a voice from this. Without it, English prose is
    // read in whatever the user's default happens to be.
    for (const [name, html] of rendered) {
      expect(html, name).toContain('<html lang="en">')
    }
  })

  it('has a main landmark', () => {
    // What "skip to content" skips to, and what a screen reader's landmark
    // list is for. There was none on any page.
    for (const [name, html] of rendered) {
      expect(html, name).toContain('<main id="content">')
    }
  })

  it('offers a skip link before anything else focusable', () => {
    // Without it, reaching the results means tabbing the account bar, the
    // masthead and a category sidebar — on every page, every time.
    for (const [name, html] of rendered) {
      const body = html.slice(html.indexOf('<body>'))
      expect(body.indexOf('class="skip-link"'), name).toBeGreaterThan(-1)
      // First, or it is not a skip link.
      expect(body.indexOf('class="skip-link"'), name).toBeLessThan(body.indexOf('<header>'))
    }
  })

  it('points the skip link at something that exists', () => {
    for (const [name, html] of rendered) {
      const target = html.match(/class="skip-link"[^>]*href="#([^"]+)"/) ??
        html.match(/href="#([^"]+)"[^>]*class="skip-link"/)
      expect(target, name).toBeTruthy()
      expect(html, name).toContain(`id="${target[1]}"`)
    }
  })

  it('has exactly one h1', () => {
    // More than one, or none, and a screen reader's outline stops meaning
    // anything. The site name is the h1; a page title is an h2 under it.
    for (const [name, html] of rendered) {
      expect((html.match(/<h1[\s>]/g) ?? []).length, name).toBe(1)
    }
  })

  it('does not skip a heading level on the way down', () => {
    for (const [name, html] of rendered) {
      const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map(m => Number(m[1]))
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `${name}: h${levels[i - 1]} → h${levels[i]}`)
          .toBeLessThanOrEqual(1)
      }
    }
  })

  it('names every navigation region', () => {
    // Two or more unlabelled <nav>s are indistinguishable in a landmark list.
    for (const [name, html] of rendered) {
      for (const nav of html.match(/<nav[^>]*>/g) ?? []) {
        expect(nav, `${name}: ${nav}`).toMatch(/aria-label=/)
      }
    }
  })

  it('gives every image alt text', () => {
    for (const [name, html] of rendered) {
      for (const img of html.match(/<img[^>]*>/g) ?? []) {
        expect(img, `${name}: ${img}`).toMatch(/\salt="/)
      }
    }
  })
})

/**
 * Tab order, which follows the source unless somebody forces it otherwise.
 *
 * Reported from the deployed site: tabbing out of the search box landed in the
 * Formats list rather than the results. Nobody decided that — the facet panel
 * was first in the markup and the grid then placed it in the *right-hand*
 * column, so focus left the search box, jumped to the far right of the page,
 * returned to the centre for the results, and ended on the far left. Three
 * columns visited right-to-left.
 */
describe('focus reaches the content before the things that refine it', () => {
  const order = html => {
    const body = html.slice(html.indexOf('<main'))
    return {
      results: body.search(/class="results"|class="page-body"/),
      facets: body.indexOf('class="side"'),
      siteLinks: body.indexOf('class="site-links"')
    }
  }

  it('puts the results before the facet panel on every page that has both', () => {
    for (const [name, render] of Object.entries(PAGES)) {
      const at = order(render())
      if (at.facets === -1 || at.results === -1) continue
      expect(at.results, `${name}: facet panel comes before the content`)
        .toBeLessThan(at.facets)
    }
  })

  it('leaves the site links last, where a footer belongs', () => {
    for (const [name, render] of Object.entries(PAGES)) {
      const at = order(render())
      if (at.siteLinks === -1 || at.facets === -1) continue
      expect(at.siteLinks, `${name}: site links come before the facet panel`)
        .toBeGreaterThan(at.facets)
    }
  })

  it('keeps the browse toggle at the top of a narrow screen', () => {
    // The panel moved in the markup; it must not move on a phone, where it is
    // one collapsed button and there was never a tab-order problem to fix.
    const css = readFileSync('templates/site.css', 'utf8')
    expect(css).toMatch(/\.columns\s*\{[^}]*flex-direction:\s*column/)
    expect(css).toMatch(/\.columns > \.browse-toggle[^{]*\{[^}]*order:\s*-1/)
  })

  it('does not reorder anything on a wide screen, where the grid places it', () => {
    const css = readFileSync('templates/site.css', 'utf8')
    const wide = css.slice(css.indexOf('@media (min-width: 58rem)'))
    expect(wide).toMatch(/\.columns > \.browse-toggle[^{]*\{[^}]*order:\s*0/)
  })
})

describe('every form control can be named without seeing it', () => {
  const forms = ['search', 'submit', 'admin', 'contributions', 'plugin']

  it('labels every visible input, or wraps it in a label', () => {
    // A placeholder is a hint and disappears on typing; it is not a name. The
    // search box had only a placeholder.
    for (const name of forms) {
      const html = PAGES[name]()
      for (const input of html.match(/<input[^>]*>/g) ?? []) {
        if (/type="(hidden|submit|checkbox)"/.test(input)) continue
        const id = input.match(/\sid="([^"]+)"/)?.[1]
        const labelled = id
          ? new RegExp(`<label[^>]*for="${id}"`).test(html)
          : /<label/.test(html.slice(Math.max(0, html.indexOf(input) - 300), html.indexOf(input)))
        expect(labelled, `${name}: ${input.slice(0, 90)}`).toBe(true)
      }
    }
  })
})

describe('the stylesheet supports keyboard use', () => {
  const css = readFileSync('templates/site.css', 'utf8')

  it('draws a focus ring on interactive things generally, not one by one', () => {
    // It was an opt-in list of exactly one control, which is the same shape as
    // the bug that left 17 links in browser-default blue.
    expect(css).toMatch(/a:focus-visible[^{]*button:focus-visible/)
    expect(css).toMatch(/outline:\s*2px solid/)
  })

  /** A rule's body, found by its selector — not by the comment above it. */
  const ruleFor = selector => {
    const at = css.indexOf(`${selector} {`)
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('hides the skip link until it is focused, rather than from everyone', () => {
    const rule = css.slice(css.indexOf('.skip-link {'))
    expect(rule).toMatch(/position:absolute/)
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/left:-\d+px/)
    expect(rule).toMatch(/\.skip-link:focus\s*\{[^}]*left:0/)
  })

  it('has a visually-hidden class that is readable, not display:none', () => {
    // display:none and visibility:hidden remove it from the accessibility tree
    // too, which defeats the point of a hidden label.
    const body = ruleFor('.visually-hidden')
    expect(body).not.toMatch(/display:\s*none/)
    expect(body).not.toMatch(/visibility:\s*hidden/)
    expect(body).toMatch(/clip:/)
  })
})

describe('no template reintroduces a pattern the pass removed', () => {
  const templates = readdirSync('templates')
    .filter(file => file.endsWith('.html'))
    .map(file => [file, readFileSync(path.join('templates', file), 'utf8')])

  it('never uses a positive tabindex', () => {
    // It reorders the whole document's focus sequence, not just its own.
    for (const [file, html] of templates) {
      expect(html, file).not.toMatch(/tabindex="[1-9]/)
    }
  })

  it('never makes a link out of "here" or "this"', () => {
    // Read out of context in a links list, they say nothing.
    for (const [file, html] of templates) {
      expect(html, file).not.toMatch(/<a[^>]*>\s*(click )?(here|this|link)\s*</i)
    }
  })
})
