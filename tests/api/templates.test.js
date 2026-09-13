import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { Templates, TemplateError, escape } from '../../src/api/Templates.js'

/**
 * The template loader.
 *
 * HTML moved out of `render.js` — 705 lines of it, including a stylesheet
 * inside a JavaScript template literal where a backtick in a CSS comment
 * silently ended the string. Pages are now files, loaded by name, the same way
 * SPARQL queries already were.
 *
 * The discipline is `QueryService`'s: every placeholder must be supplied and
 * every supplied value must be used. Both directions, because a missing value
 * renders an empty region of a page and says nothing, while a surplus one means
 * the template and its caller have drifted apart.
 */

const templates = new Templates()

describe('filling a template', () => {
  it('escapes a value by default', () => {
    // The whole reason escaping is the default rather than an option.
    const html = templates.render('tag', { value: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('inserts a triple-braced value as-is, for HTML already built', () => {
    const html = templates.render('meta-line', { text: 'plain' })
    expect(html).toContain('plain')
    // description.html takes a raw fragment nowhere; layout does.
    expect(templates.placeholders('layout').has('body')).toBe(true)
  })

  it('escapes a quote so it cannot close an attribute', () => {
    expect(escape('" onmouseover="evil()')).not.toContain('"')
  })

  it('refuses a value the template does not use', () => {
    // A caller passing `tittle` for `title` would otherwise render a page with
    // an empty title and no complaint.
    expect(() => templates.render('tag', { value: 'x', surplus: 'y' })).toThrow(TemplateError)
  })

  it('refuses to render with a placeholder unsupplied', () => {
    expect(() => templates.render('tag', {})).toThrow(/needs values not supplied/)
  })

  it('renders an explicitly empty value without complaint', () => {
    // Empty is a value; absent is a mistake. They must not be the same thing.
    expect(() => templates.render('tag', { value: '' })).not.toThrow()
  })
})

describe('the loader', () => {
  it('refuses a name that could escape the template directory', () => {
    for (const bad of ['../../etc/passwd', '/etc/passwd', 'a/../../b']) {
      expect(() => templates.template(bad), bad).toThrow(TemplateError)
    }
  })

  it('reports a missing template by name', () => {
    expect(() => templates.template('no-such-template')).toThrow(/No such template/)
  })

  it('re-reads a template when the file changes', () => {
    // Cached by mtime, like the query loader, so editing a page during
    // development does not need a restart.
    const first = templates.template('tag')
    expect(templates.template('tag')).toBe(first)
  })

  it('serves the stylesheet as an asset, not as a template', () => {
    expect(templates.asset('site.css')).toContain(':root')
  })

  it('refuses an asset name with a path in it', () => {
    expect(() => templates.asset('../package.json')).toThrow(TemplateError)
  })
})

describe('no loops and no conditionals, on purpose', () => {
  it('builds a list by filling a row template and joining', () => {
    const html = templates.each('tag', ['a', 'b'], value => ({ value }))
    expect(html).toContain('>a<')
    expect(html).toContain('>b<')
  })

  it('renders a fragment or nothing, which is what replaces an if', () => {
    expect(templates.when(true, 'tag', { value: 'x' })).toContain('x')
    expect(templates.when(false, 'tag', { value: 'x' })).toBe('')
  })
})

describe('every template on disk', () => {
  const names = templates.list()

  it('finds them', () => {
    expect(names.length).toBeGreaterThan(20)
  })

  it('is referenced by name somewhere in the code', () => {
    // A template nothing renders is dead weight that still looks maintained.
    // Walks src/ rather than naming files: listing them meant the wiki's
    // renderer went unscanned the moment it was added, which is the same
    // two-places-to-update defect the templates were meant to reduce.
    const code = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) code.push(fs.readFileSync(full, 'utf8'))
      }
    }
    walk('src')
    const source = code.join('\n')
    const orphans = names.filter(name => !source.includes(`'${name}'`))
    expect(orphans, `no code renders: ${orphans.join(', ')}`).toEqual([])
  })

  it('uses only placeholder syntax that the loader understands', () => {
    // A stray ${...} left over from the template-literal days would render as
    // a literal dollar-brace on the page.
    for (const name of names) {
      expect(templates.template(name), name).not.toMatch(/\$\{/)
    }
  })
})

describe('the templates reach the deployment', () => {
  it('is not excluded by .dockerignore', () => {
    // docs/ was excluded after the app began serving pages from it, and the
    // only symptom was 500s on three routes in production. Every page comes
    // from templates/ now, so the same mistake would take the whole site down.
    const ignored = fs.readFileSync('.dockerignore', 'utf8')
      .split('\n').map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    for (const rule of ignored) {
      expect(rule.replace(/^!/, '').replace(/\/$/, ''), `.dockerignore excludes ${rule}`)
        .not.toBe('templates')
    }
  })
})

/**
 * A placeholder is still a placeholder.
 *
 * `templates/layout.html` read `<style>{{{style}}}</style>`, which put a
 * placeholder inside a CSS context — and an editor's "format document" parsed
 * those braces as CSS and pretty-printed them across eight lines:
 *
 *     <style>
 *       {
 *           {
 *             {
 *             style
 *           }
 *         }
 *       }
 *     </style>
 *
 * The placeholder stopped existing, so `layout` was handed a value it no longer
 * used, and the deployment refused to start. The suite did catch it — in 81
 * failures across 18 files, none of which said "a formatter ate a placeholder".
 * This says it in one.
 *
 * The `<style>` tags have since moved into the value, so there is no CSS in any
 * template for a formatter to find. This is the check that the next one does
 * not get in either way.
 */
describe('no template has had its placeholders mangled', () => {
  const files = fs.readdirSync('templates').filter(name => name.endsWith('.html'))

  it('finds templates to check at all', () => {
    // Without this the suite passes by vacuum, which is the failure mode of
    // every test whose subject is "nothing is broken".
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s has no orphaned brace on a line of its own', file => {
    const text = fs.readFileSync(`templates/${file}`, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      expect(line.trim(), `${file}:${index + 1} is a bare brace — a placeholder has been reformatted`)
        .not.toMatch(/^\{+$|^\}+$/)
    })
  })

  it.each(files)('%s opens and closes every placeholder on one line', file => {
    const text = fs.readFileSync(`templates/${file}`, 'utf8')
    for (const line of text.split('\n')) {
      const opens = (line.match(/\{\{/g) ?? []).length
      const closes = (line.match(/\}\}/g) ?? []).length
      expect(opens, `${file}: "${line.trim()}" opens a placeholder it does not close`).toBe(closes)
    }
  })

  it('keeps no CSS or script body in a template, where a formatter would find it', () => {
    // The shape that caused this: a placeholder inside a <style> or <script>
    // element is in a language an editor knows how to reformat. Keeping those
    // elements on the JavaScript side leaves nothing for it to act on.
    for (const file of files) {
      const text = fs.readFileSync(`templates/${file}`, 'utf8')
      expect(text, `${file} contains a <style> element; put the tags in the value instead`)
        .not.toMatch(/<style[^>]*>/)
      expect(text, `${file} contains an inline <script> body`).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/)
    }
  })
})
