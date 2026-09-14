import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync} from 'fs'
import { renderSearchPage, renderPluginPage, renderDocPage } from '../../src/api/render.js'

/**
 * The narrow-screen layout.
 *
 * A stylesheet is not something a unit test can look at, so these assert the
 * few rules whose *absence* caused a specific reported problem, and nothing
 * about how it looks. Each one is here because it broke:
 *
 *  - the account bar is absolutely positioned in the header's top-right
 *    corner, which was fine when it held one login link and collided with the
 *    title once it held two links and a button
 *  - the correction field carries min-width:16rem, which is 256px and overflows
 *    a 360px viewport once page padding is counted, dragging the whole document
 *    sideways
 *  - 15px body text is a density choice for a wide window
 *
 * Whether it now looks right is a question for a person with a phone.
 */

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1234abcd',
  name: 'Example', vendor: 'Vendor', description: 'A plugin.',
  formats: ['VST3'], categories: ['reverb'], roles: [], tags: [], parameters: []
}

const page = renderSearchPage({
  query: null, facets: {}, results: [], total: 0, corpus: 645, facetValues: {}
})

/** The contents of the narrow-screen media query. */
function narrowBlock (html) {
  const start = html.indexOf('@media (max-width: 48rem)')
  if (start === -1) return null
  let depth = 0
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1)
  }
  return null
}

describe('every page', () => {
  it('tells a phone not to pretend it is a desktop', () => {
    // Without this a phone renders at 980px and scales down, which is the
    // other way a page ends up unreadably small.
    expect(page).toContain('name="viewport"')
    expect(page).toContain('width=device-width')
  })

  it('has a narrow-screen block at all', () => {
    expect(narrowBlock(page), 'no @media (max-width: 48rem) in the stylesheet').toBeTruthy()
  })
})

describe('on a narrow screen', () => {
  const narrow = narrowBlock(page)

  it('takes the account bar out of the header corner', () => {
    // It holds a login, two links and a button now. Absolutely positioned in
    // the corner, it sat on the title.
    expect(narrow).toMatch(/\.account\s*\{[^}]*position:\s*static/)
  })

  it('lets the correction field shrink below its desktop minimum', () => {
    expect(narrow).toMatch(/min-width:\s*0/)
  })

  it('raises the type scale at the root, which is the only place that moves it', () => {
    // Setting body's font-size leaves every rem-sized caption exactly where it
    // was, because rem is relative to the root element. That is what "too
    // small on mobile" turned out to be: corrected paragraphs and 12.8px tags.
    const root = narrow.match(/:root\s*\{[^}]*font-size:\s*([\d.]+)px/)
    expect(root, 'the narrow block does not set :root font-size').toBeTruthy()
    expect(Number(root[1])).toBeGreaterThan(16)
  })

  it('does not leave the small print at desktop proportions', () => {
    // .8rem of anything is not a caption size on a handset.
    const smallest = [...narrow.matchAll(/font-size:\s*([\d.]+)rem/g)].map(match => Number(match[1]))
    expect(smallest.length).toBeGreaterThan(3)
    expect(Math.min(...smallest), 'something is still under .85rem on a phone')
      .toBeGreaterThanOrEqual(0.85)
  })

  it('gives a wide table its own scrollbar rather than the document\'s', () => {
    expect(narrow).toMatch(/table\s*\{[^}]*overflow-x:\s*auto/)
  })

  it('puts the facets two to a row rather than four across', () => {
    // Four dropdowns sharing a line with a text field leaves every one of them
    // too narrow to read its own values.
    expect(narrow).toMatch(/\.facets select\s*\{[^}]*calc\(50%/)
  })
})

describe('what the desktop layout keeps', () => {
  it('still positions the account bar in the corner on a wide screen', () => {
    const wide = page.slice(0, page.indexOf('@media (max-width: 48rem)'))
    expect(wide).toMatch(/\.account\s*\{[^}]*position:absolute/)
  })

  it('renders a plugin page with an image without a fixed width that overflows', () => {
    // A hotlinked image at its natural size is the third way a page scrolls
    // sideways.
    const plugin = renderPluginPage({ ...DOC, image: 'https://example.invalid/a.jpg' })
    expect(plugin).toMatch(/\.shot-full\s*\{[^}]*max-width/)
    expect(plugin).toMatch(/img\s*\{[^}]*max-width:\s*100%|\.shot\b/)
  })
})

/**
 * Links are styled by default, not by a list somebody has to remember.
 *
 * The colour used to be opt-in per context — `.account a`, `.pager a`,
 * `footer a`, `.prov a`, `.prose a` — so a block added later fell off the list
 * without anything complaining. Seventeen of the thirty-five links on the front
 * page rendered in the browser's default blue: the services note, and every tag
 * link on every result. Nobody chose that; it was what happens when a default
 * is a list.
 *
 * This is the same shape as the recurring failure in CLAUDE.md, in CSS. The
 * test asserts the base rule exists, because its absence is what let the gap
 * open and reappear silently.
 */
describe('link colour', () => {
  const CSS = readFileSync('templates/site.css', 'utf8')

  it('sets a colour for every link, not one context at a time', () => {
    expect(CSS).toMatch(/^a \{[^}]*color:\s*var\(--accent\)/m)
  })

  it('keeps the deliberate exceptions, which are exceptions and not omissions', () => {
    // The site title is a link and must not look like one.
    expect(CSS).toMatch(/h1 a \{[^}]*color:\s*inherit/)
  })
})

/**
 * Browsing by format and category.
 *
 * One list of links, placed beside the results on a wide screen and collapsed
 * behind a toggle on a narrow one. Two lists would be two things to keep
 * correct, and the counts beside each link come from the same facet query the
 * dropdowns are built from — so the nav cannot offer a category nothing is in.
 *
 * The toggle is a checkbox, not script. These assert the properties that make
 * that acceptable rather than merely clever: the control stays in the focus
 * order, and the label is tied to it.
 */
describe('the browse panel', () => {
  const CSS = readFileSync('templates/site.css', 'utf8')
  const page = renderSearchPage({
    query: null,
    facets: {},
    results: [],
    total: 0,
    corpus: 645,
    facetValues: {
      format: [{ value: 'VST3', count: 499 }, { value: 'LV2', count: 201 }],
      category: [{ value: 'reverb', count: 43 }, { value: 'delay', count: 35 }]
    }
  })

  it('links formats to the filtered browse list and categories to their pages', () => {
    expect(page).toContain('href="/plugins?format=VST3"')
    expect(page).toContain('href="/category/reverb"')
  })

  it('shows how much is behind each link', () => {
    // A category with 43 plugins and one with 2 are different invitations.
    expect(page).toContain('499')
    expect(page).toContain('43')
  })

  it('offers a way to the whole catalogue, not just the parts', () => {
    expect(page).toContain('href="/plugins"')
  })

  it('collapses on a narrow screen and opens without script', () => {
    // The mechanism is a checkbox and a sibling selector, so the panel opens
    // with JavaScript off, blocked or broken. This used to assert the page
    // contained no `<script>` at all, which was a sound proxy while it served
    // none; the site now serves one, for a spinner on submit buttons, and the
    // commitment being guarded is that *this* does not depend on it.
    expect(CSS).toMatch(/\.side\s*\{[^}]*display:\s*none/)
    expect(CSS).toMatch(/\.browse-toggle:checked\s*~\s*\.side\s*\{[^}]*display:\s*block/)
    expect(page).toContain('type="checkbox"')
    // Nothing scripted touches the toggle or the panel.
    const script = readFileSync('templates/site.js', 'utf8')
    expect(script).not.toMatch(/browse-toggle|\.side\b/)
  })

  it('serves its one script as a deferred external file, never inline', () => {
    // Inline would work — there is no Content-Security-Policy today — and would
    // mean an exception the day there is one. Deferred so a page that needs
    // nothing from it is not held up rendering.
    expect(page).toMatch(/<script src="\/site\.js" defer><\/script>/)
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)/i)
  })

  it('adds nothing a form needs in order to work', () => {
    // Progressive enhancement, asserted rather than intended: the script may
    // not disable a submit button. Seven templates dispatch on the pressed
    // button's own name and value, and a disabled button is not submitted —
    // so disabling it, the usual way to stop a double post, would drop the
    // field that says which action this is.
    const script = readFileSync('templates/site.js', 'utf8')
    expect(script).not.toMatch(/\.disabled\s*=|setAttribute\(\s*['"]disabled/)
    expect(script).toContain('aria-busy')
  })

  it('leaves a form usable after a button that downloads rather than navigates', () => {
    // The defect this exists for. The spinner is cleared by the page being
    // replaced, which every POST here did until Download profile: a download
    // answers with an attachment and leaves the document alone, so the spinner
    // never stopped — and the form stayed latched, which meant the *Submit*
    // button silently did nothing afterwards.
    const script = readFileSync('templates/site.js', 'utf8')
    expect(script).toContain('data-no-navigate')
    // The exemption has to be taken before the form is latched, or the form is
    // still dead and only the spinner is fixed.
    expect(script.indexOf('data-no-navigate'))
      .toBeLessThan(script.indexOf("setAttribute('data-busy'"))
  })

  it('marks every downloading button, so none of them latches its form', () => {
    // Both directions, because a script that knows about the attribute and a
    // button that does not carry it is exactly as broken as neither.
    const templates = readdirSync('templates').filter(name => name.endsWith('.html'))
    let checked = 0
    for (const name of templates) {
      const html = readFileSync(`templates/${name}`, 'utf8')
      for (const button of html.match(/<button[^>]*>/g) ?? []) {
        // A download is recognisable here by the action it posts; the route
        // answers those with Content-Disposition.
        if (!/name="download"/.test(button)) continue
        checked++
        expect(button, `${name}: a downloading button must declare data-no-navigate`)
          .toMatch(/data-no-navigate/)
      }
    }
    expect(checked, 'no downloading button found — has the marker been renamed?')
      .toBeGreaterThan(0)
  })

  it('unlatches a form restored from the browser cache', () => {
    // Submit, then Back. The browser may restore this document with data-busy
    // still set, leaving the form dead for a reason nobody could guess.
    const script = readFileSync('templates/site.js', 'utf8')
    expect(script).toContain('pageshow')
    expect(script).toContain('persisted')
    expect(script).toMatch(/removeAttribute\(['"]data-busy/)
  })

  it('keeps the toggle reachable by keyboard', () => {
    // `display:none` and the `hidden` attribute both take a control out of the
    // focus order. Moved off-screen instead, so it can still be tabbed to.
    expect(page).not.toMatch(/<input[^>]*class="browse-toggle"[^>]*hidden/)
    expect(CSS).toMatch(/\.browse-toggle\s*\{[^}]*position:\s*absolute/)
    expect(CSS).not.toMatch(/\.browse-toggle\s*\{[^}]*display:\s*none/)
    expect(page).toContain('for="browse-toggle"')
    expect(page).toContain('id="browse-toggle"')
  })

  it('shows the panel and hides the toggle on a wide screen', () => {
    const wide = CSS.slice(CSS.indexOf('@media (min-width: 58rem)'))
    expect(wide).toMatch(/\.columns \.side\s*\{[^}]*display:\s*block/)
    expect(wide).toMatch(/\.browse-button\s*\{\s*display:\s*none/)
  })

  it('puts each kind of thing in its own column on a wide screen', () => {
    const wide = CSS.slice(CSS.indexOf('@media (min-width: 58rem)'))
    expect(wide).toMatch(/\.columns\s*\{[^}]*grid-template-columns:\s*11rem minmax\(0, 1fr\) 14rem/)
    // Where to go, what is here, what to browse.
    expect(wide).toMatch(/\.columns \.site-links\s*\{[^}]*grid-column:\s*1/)
    expect(wide).toMatch(/\.columns \.results[^{]*\{[^}]*grid-column:\s*2/)
    expect(wide).toMatch(/\.columns \.side\s*\{[^}]*grid-column:\s*3/)
  })

  it('is labelled, because a list of links with no heading is a list of words', () => {
    expect(page).toContain('aria-label="Browse the catalogue"')
  })
})

/**
 * One list of site links, in one place per page.
 *
 * They are the footer on most pages and the left column on the three that have
 * columns. Rendered from a single template either way: two copies of a list
 * that includes the contributor terms is two lists to keep correct, and the
 * cost of them disagreeing is a reader following the wrong one.
 */
describe('the site links', () => {
  const shellPage = renderSearchPage({
    query: 'x', facets: {}, results: [], total: 0, corpus: 10, facetValues: {}
  })

  it('are a column, not a footer, on a page that has columns', () => {
    expect(shellPage).toContain('class="site-links"')
    expect(shellPage).not.toContain('<footer>')
  })

  const prose = renderDocPage({ title: 'About', description: 'x', html: '<p>Words.</p>' })

  it('are a footer on a page that has no columns', () => {
    // The prose pages — /about, /terms, /services — are a single column of
    // text and keep the footer they always had.
    expect(prose).toContain('<footer>')
    expect(prose).toContain('class="site-links"')
  })

  it('are a column on a plugin page, which gained them', () => {
    const plugin = renderPluginPage(DOC)
    expect(plugin).toContain('class="columns"')
    expect(plugin).not.toContain('<footer>')
    expect(plugin).toContain('class="site-links"')
  })

  it('appear once per page, never twice', () => {
    for (const page of [shellPage, prose, renderPluginPage(DOC)]) {
      expect(page.match(/class="site-links"/g)).toHaveLength(1)
    }
  })

  it('carry the licence and a way further in, wherever they are', () => {
    // This used to require `href="/terms"` here too, on the reasoning that
    // somebody about to contribute is owed the terms wherever they happen to be
    // standing. The footer is now five links by editorial decision and the
    // terms are not among them, so the requirement has moved to where a person
    // is actually about to contribute — see below.
    for (const page of [shellPage, prose, renderPluginPage(DOC)]) {
      expect(page).toContain('href="/services"')
      expect(page).toContain('CC0 1.0')
    }
  })
})

/**
 * The contributor terms, reachable from the pages where they matter.
 *
 * They were in the footer of every page until the link list was cut to five.
 * Dropping the assertion entirely would have left nothing at all requiring them
 * to be findable, so it moved rather than disappeared: the four surfaces where
 * somebody is *about to give this project something* each link them, which is a
 * narrower claim than the old one and a truer one.
 */
describe('where the contributor terms are reachable', () => {
  const CONTRIBUTING = [
    'templates/submit.html',
    'templates/correct-form.html',
    'templates/correct-signed-out.html',
    'templates/image-form.html',
    'templates/contributions.html'
  ]

  it('is every form that asks a person for something', () => {
    for (const file of CONTRIBUTING) {
      expect(readFileSync(file, 'utf8'), `${file} asks for a contribution and does not link the terms`)
        .toContain('href="/terms"')
    }
  })

  it('and the index on the About page, for everybody else', () => {
    expect(readFileSync('docs/about.md', 'utf8')).toContain('(/terms)')
  })
})

/**
 * The account bar.
 *
 * It has collided with the title twice — once when it grew from one link to two
 * and a button, and again when a third was added. An absolutely positioned
 * corner cannot say "I have run out of room", so these assert the two things
 * that stop it overflowing silently: it folds, and its markup is valid enough
 * that the browser does not rearrange it.
 */
describe('the account bar', () => {
  const CSS = readFileSync('templates/site.css', 'utf8')
  const signedIn = renderSearchPage({
    query: null, facets: {}, results: [], total: 0, corpus: 0, facetValues: {},
    viewer: { account: { login: 'danja', trustLevel: 'moderator' }, signInEnabled: true }
  })

  it('does not put a form inside a paragraph', () => {
    // `<form>` is not permitted inside `<p>`: the parser closes the paragraph
    // before it, which hoisted the sign-out button out of the bar and into
    // normal flow at the left of the page. Nothing complained — the HTML was
    // accepted, rearranged, and rendered wrong.
    const bar = signedIn.slice(signedIn.indexOf('class="account"'))
    const openTag = signedIn.slice(0, signedIn.indexOf('class="account"')).lastIndexOf('<p')
    const divTag = signedIn.slice(0, signedIn.indexOf('class="account"')).lastIndexOf('<div')
    expect(divTag, 'the account bar is a <p>, and it contains a <form>').toBeGreaterThan(openTag)
    expect(bar).toContain('<form')
  })

  it('folds instead of running off the side', () => {
    expect(CSS).toMatch(/\.account\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(CSS).toMatch(/\.account\s*\{[^}]*max-width/)
  })

  it('links the admin page for a moderator and not for anyone else', () => {
    expect(signedIn).toContain('href="/admin"')
    const plain = renderSearchPage({
      query: null, facets: {}, results: [], total: 0, corpus: 0, facetValues: {},
      viewer: { account: { login: 'someone', trustLevel: 'new' }, signInEnabled: true }
    })
    expect(plain).not.toContain('href="/admin"')
  })
})
