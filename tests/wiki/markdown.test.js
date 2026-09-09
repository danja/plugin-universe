import { describe, it, expect } from 'vitest'
import { renderWikiMarkdown, safeHref } from '../../src/wiki/markdown.js'

/**
 * Markdown written by a stranger and served to everybody else.
 *
 * This is the first place in the project where text from outside becomes HTML
 * inside a page, so the tests are written as attacks rather than as features.
 * marked does not sanitise — its own documentation says so — and the approach
 * here is to stop dangerous constructs being emitted rather than to clean them
 * up afterwards.
 *
 * If any of these fails, the wiki must not be served.
 */

const render = source => renderWikiMarkdown(source)

describe('raw HTML never survives', () => {
  it('drops a script tag and keeps only its text', () => {
    const html = render('Hello <script>alert(1)</script> world')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('</script')
  })

  it('drops inline formatting tags rather than trusting them', () => {
    // <b> is harmless; allowing it means deciding which tags are harmless, and
    // that list is where sanitisers go wrong.
    expect(render('a <b>bold</b> word')).not.toContain('<b>')
  })

  it('drops a block of HTML', () => {
    const html = render('<div onclick="evil()">hello</div>')
    expect(html).not.toContain('<div')
    expect(html).not.toContain('onclick')
  })

  it('drops an event handler on any attempted tag', () => {
    expect(render('<img src=x onerror=alert(1)>')).not.toContain('onerror')
  })

  it('drops an iframe', () => {
    expect(render('<iframe src="https://evil.invalid"></iframe>')).not.toContain('<iframe')
  })

  it('does not let an unclosed tag swallow the rest of the page', () => {
    const html = render('<svg><style>')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<style')
  })

  it('keeps HTML inside a code fence visible, as code', () => {
    // The reason this is not solved by escaping the source before parsing:
    // that breaks every code block, and a plugin wiki will contain markup.
    const html = render('```html\n<div>example</div>\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('&lt;div&gt;example&lt;/div&gt;')
  })
})

describe('link schemes', () => {
  it('renders an http and an https link', () => {
    expect(render('[a](https://example.org)')).toContain('href="https://example.org"')
    expect(render('[a](http://example.org)')).toContain('href="http://example.org"')
  })

  it('refuses a javascript: URL, which marked passes through untouched', () => {
    // Verified against marked rather than assumed: it emits this happily.
    const html = render('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click')
  })

  it('refuses data: and vbscript:', () => {
    for (const scheme of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)']) {
      expect(render(`[x](${scheme})`), scheme).not.toContain('href=')
    }
  })

  it('allows a link into this site', () => {
    expect(render('[reverbs](/category/reverb)')).toContain('href="/category/reverb"')
  })

  it('refuses a protocol-relative URL, which looks relative and is not', () => {
    expect(safeHref('//evil.invalid/x')).toBeNull()
  })

  it('marks every link nofollow ugc, so the wiki is not a ranking gift', () => {
    expect(render('[a](https://example.org)')).toContain('rel="nofollow ugc noopener"')
  })
})

describe('images are links, not loads', () => {
  it('does not emit an img tag', () => {
    // Every reader's browser would fetch it from a third party: a tracking
    // pixel, a hotlink to something illegal, or fifty megabytes.
    const html = render('![alt](https://example.org/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://example.org/a.png"')
    expect(html).toContain('alt')
  })

  it('does not emit a link for an image with an unsafe scheme either', () => {
    expect(render('![x](javascript:alert(1))')).not.toContain('href=')
  })
})

describe('ordinary Markdown still works', () => {
  it('renders emphasis, lists and code', () => {
    const html = render('*em* and **strong**\n\n- one\n- two\n\n`code`')
    expect(html).toContain('<em>em</em>')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders a table, since GFM is on', () => {
    expect(render('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>')
  })

  it('demotes headings so they cannot outrank the page title', () => {
    // A contributor writing "# Reverb" should not produce a second h1.
    const html = render('# Heading')
    expect(html).not.toContain('<h1>')
    expect(html).toContain('<h3>Heading</h3>')
  })

  it('gives headings no id, so user prose cannot collide with the page', () => {
    expect(render('## Heading')).not.toContain('id=')
  })

  it('escapes ampersands and angle brackets in ordinary text', () => {
    const html = render('a & b < c')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;')
  })

  it('renders nothing for nothing', () => {
    expect(render('')).toBe('')
    expect(render(null)).toBe('')
  })
})
