import { describe, it, expect } from 'vitest'
import { renderWikiBlock, renderWikiEditor, renderWikiHistory } from '../../src/wiki/render.js'

/**
 * The wiki's pages.
 *
 * Mostly about the licence, because that is what makes wiki prose different
 * from everything else on the site: it is CC BY-SA on a page whose facts are
 * CC0, and CC BY-SA requires naming the author. A byline is a licence term
 * here, not decoration.
 */

const CURRENT = {
  revision: 'http://purl.org/stuff/plugin-universe/revision/x-1-abcd1234',
  text: 'A *plate* reverb.\n\nSee [compressors](/category/compressor).',
  author: 'http://purl.org/stuff/plugin-universe/person/github-2303-1b505ba2',
  authorName: 'danja',
  at: '2026-09-09T19:12:00.000Z'
}

describe('the prose block on a plugin page', () => {
  const html = renderWikiBlock(CURRENT, 'wet-reverb-693085a0')

  it('renders the Markdown', () => {
    expect(html).toContain('<em>plate</em>')
    expect(html).toContain('href="/category/compressor"')
  })

  it('names the author, because the licence requires it', () => {
    expect(html).toContain('Written by danja')
  })

  it('does not credit a content hash when the account is gone', () => {
    // The account IRI ends in a hash, so falling back to it named nobody —
    // the byline read "1b505ba2".
    const orphaned = renderWikiBlock({ ...CURRENT, authorName: undefined }, 'x')
    expect(orphaned).not.toContain('1b505ba2')
    expect(orphaned).toContain('withdrawn')
  })

  it('says the prose is licensed differently from the facts above it', () => {
    // A reader is looking at CC0 and CC BY-SA on one page and nothing else
    // would tell them.
    expect(html).toContain('CC BY-SA 4.0')
    expect(html).toContain('CC0')
  })

  it('offers a way to edit and a way to see the history', () => {
    expect(html).toContain('/plugin/wet-reverb-693085a0/wiki/edit')
    expect(html).toContain('/plugin/wet-reverb-693085a0/wiki/history')
  })

  it('invites a first page rather than showing an empty box', () => {
    const empty = renderWikiBlock(null, 'wet-reverb-693085a0')
    expect(empty).toMatch(/Nobody has written/)
    expect(empty).toContain('/wiki/edit')
  })

  it('drops raw HTML from the prose it renders', () => {
    const nasty = renderWikiBlock({ ...CURRENT, text: '<script>alert(1)</script>' }, 'x')
    expect(nasty).not.toContain('<script')
  })
})

describe('the editor', () => {
  const html = renderWikiEditor('wet-reverb-693085a0', { csrfToken: 'tok', text: 'hello', previous: 'rev-1' })

  it('carries the revision it started from', () => {
    // Sent back on save so a write built on a stale copy is refused rather
    // than silently overwriting somebody else's edit.
    expect(html).toContain('name="previous" value="rev-1"')
  })

  it('carries a CSRF token', () => {
    expect(html).toContain('name="csrf" value="tok"')
  })

  it('escapes the existing text into the textarea', () => {
    const withTags = renderWikiEditor('x', { csrfToken: 't', text: '</textarea><script>alert(1)</script>' })
    expect(withTags).not.toContain('</textarea><script>')
    expect(withTags).toContain('&lt;/textarea&gt;')
  })

  it('says what licence the writing will carry before it is written', () => {
    expect(html).toContain('CC BY-SA')
  })

  it('shows the current version when there was a conflict', () => {
    const conflicted = renderWikiEditor('x', {
      csrfToken: 't',
      text: 'mine',
      conflict: { message: 'Somebody else saved.', current: { text: 'theirs' } }
    })
    expect(conflicted).toContain('mine')
    expect(conflicted).toContain('theirs')
    expect(conflicted).toMatch(/Somebody else saved/)
  })
})

describe('the history', () => {
  const html = renderWikiHistory('wet-reverb-693085a0', [
    { ...CURRENT, length: 116, summary: 'first notes' },
    { ...CURRENT, revision: 'http://purl.org/stuff/plugin-universe/revision/x-0-00000000', length: 40, at: '2026-09-08T10:00:00.000Z', summary: null }
  ])

  it('marks which revision is current', () => {
    expect(html).toContain('current')
  })

  it('links each revision so an old version can be read', () => {
    expect(html).toContain('wiki?revision=x-1-abcd1234')
  })

  it('names who wrote each one', () => {
    expect(html.match(/danja/g).length).toBeGreaterThanOrEqual(2)
  })

  it('explains that nothing is deleted', () => {
    expect(html).toMatch(/ever edited or deleted/)
  })

  it('says so plainly when there is no history', () => {
    expect(renderWikiHistory('x', [])).toMatch(/No notes have been written/)
  })
})
