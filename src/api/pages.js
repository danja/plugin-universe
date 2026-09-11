import fs from 'fs'
import { join as pathJoin } from 'path'
import { marked } from 'marked'

/**
 * The prose pages — about, terms, the crawler notice.
 *
 * These are the repository's own Markdown documents, rendered into the site's
 * layout so that a visitor reads them as part of the site rather than as a file
 * on GitHub. Keeping one copy means the terms a contributor agrees to and the
 * terms in the repository cannot drift apart, which for a document with legal
 * effect matters more than the convenience.
 *
 * **This path renders trusted content only.** `marked` has not sanitised its
 * output since v5 — raw HTML in the source passes straight through. That is
 * fine for documents committed to this repository and reviewed in a pull
 * request, and it is emphatically not fine for the Phase 3 wiki. When user
 * prose arrives it needs its own renderer with HTML disabled and an allow-list
 * on top; do not reuse this function for it.
 */

export class PageError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PageError'
  }
}

/**
 * The pages served, by path, and the document behind each.
 *
 * A whitelist rather than a directory listing: "render whatever is under docs/"
 * would publish the working notes, the mistake log and the implementation plan
 * the moment someone guessed a filename.
 */
export const PAGES = Object.freeze({
  '/about': {
    file: 'docs/about.md',
    title: 'About',
    description: 'An open, machine-readable database of DAW plugins. What it is, who it is for, and the licence.'
  },
  '/terms': {
    file: 'docs/contributor-terms.md',
    title: 'Contributor terms',
    description: 'What you agree to when you contribute: CC0 for facts, CC BY-SA for prose.'
  },
  '/services': {
    file: 'docs/services.md',
    title: 'Services',
    description: 'Every way the Plugin Universe catalogue can be read: web, JSON, RDF, SPARQL, a package registry and MCP.'
  },
  '/about/mcp': {
    file: 'docs/mcp.md',
    title: 'The MCP endpoint',
    description: 'The Plugin Universe catalogue as tools an agent can call.'
  },
  '/about/sparql': {
    file: 'docs/sparql.md',
    title: 'The public SPARQL endpoint',
    description: 'A read-only, open SPARQL endpoint over the Plugin Universe catalogue.'
  },
  '/about/measurements': {
    file: 'docs/measurements.md',
    // Linked from the Measured block on every plugin page that has one, so it
    // is what somebody clicks having just been shown a verdict they did not
    // expect. It has to answer "measured by whom, how, and does `crashed` mean
    // my plugin is broken?" before anything else.
    title: 'Measurements',
    description: 'What the profiler measures, what each verdict means, and why a reading is about one binary on one machine.'
  },
  '/about/crawler': {
    file: 'docs/crawler.md',
    title: 'About the crawler',
    // The harvester's user agent points here, so it is the first thing a
    // sysadmin reading their logs will see. It has to answer their question.
    description: 'What the Plugin Universe harvester does, how it behaves, and how to make it stop.'
  }
})

/**
 * Rewrite the documents' inter-links so they work as web routes.
 *
 * The Markdown links to sibling files — `[about](about.md)` — which is right in
 * the repository and a 404 on the site. Documents that have a route get it;
 * the rest are developer documentation and link to the repository, because a
 * broken link in the terms is worse than an off-site one.
 */
const REPO = 'https://github.com/danja/plugin-universe/blob/main/docs/'

export function rewriteLink (href) {
  if (!href || /^(https?:|mailto:|#|\/)/.test(href)) return href
  const [file, fragment] = href.split('#')
  for (const [route, page] of Object.entries(PAGES)) {
    if (page.file.endsWith(`/${file}`)) return fragment ? `${route}#${fragment}` : route
  }
  return `${REPO}${href}`
}

/**
 * Render one document to HTML.
 *
 * Headings get ids so a section can be linked to — the terms in particular get
 * cited section by section.
 */
export function renderMarkdown (source) {
  const renderer = new marked.Renderer()

  const baseLink = renderer.link.bind(renderer)
  renderer.link = token => baseLink({ ...token, href: rewriteLink(token.href) })

  const slugs = new Map()
  renderer.heading = ({ tokens, depth }) => {
    const text = this === undefined ? marked.parser(tokens) : marked.parser(tokens)
    const plain = text.replace(/<[^>]*>/g, '').trim()
    let slug = plain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'
    // Two sections can share a heading; a duplicate id makes one of them
    // unlinkable rather than raising anything.
    const seen = slugs.get(slug) ?? 0
    slugs.set(slug, seen + 1)
    if (seen > 0) slug = `${slug}-${seen}`
    return `<h${depth} id="${slug}">${text}</h${depth}>\n`
  }

  return marked.parse(source, { renderer, gfm: true })
}

/** Load and render a page, or null when the path is not one we serve. */
export async function loadPage (path, projectRoot = process.cwd()) {
  const page = PAGES[path]
  if (!page) return null
  const file = pathJoin(projectRoot, page.file)
  if (!fs.existsSync(file)) {
    throw new PageError(`${path} is served from ${page.file}, which is missing`)
  }
  return { ...page, html: renderMarkdown(await fs.promises.readFile(file, 'utf8')) }
}

export default loadPage
