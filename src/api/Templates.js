import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * File-based HTML templates.
 *
 * The same idea as `QueryService`, for the same reason. SPARQL lives in
 * `sparql/queries/` rather than in template literals because a query is a
 * document with its own syntax that an editor can check and a person can read;
 * a page is too. `render.js` had grown to 705 lines of mostly HTML, including
 * a stylesheet inside a JavaScript template literal — where a backtick in a CSS
 * comment silently ended the string and broke the build.
 *
 * One loader, one syntax, as with queries:
 *
 *   {{name}}     the value, HTML-escaped
 *   {{{name}}}   the value inserted as-is, for a fragment already built as HTML
 *
 * **There are no loops and no conditionals**, deliberately. A template language
 * grows until it is a worse programming language, and the escaping question
 * gets harder with every construct added. A list is built in JavaScript by
 * filling a row template and joining, then passed in as `{{{rows}}}`; an
 * optional block is either a filled fragment or an empty string. What a
 * template does is lay out; what decides is code.
 *
 * Every placeholder must be supplied and every supplied key must be used —
 * both directions, because a missing value silently renders an empty page
 * region and a surplus one means the template and its caller have drifted.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '../..')

export class TemplateError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TemplateError'
  }
}

/** HTML-escape a value for insertion into text or a double-quoted attribute. */
export function escape (text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PLACEHOLDER = /\{\{\{([a-zA-Z0-9_]+)\}\}\}|\{\{([a-zA-Z0-9_]+)\}\}/g

export class Templates {
  constructor ({ templatePath = path.join(PROJECT_ROOT, 'templates') } = {}) {
    this.templatePath = templatePath
    this.cache = new Map()
  }

  #resolve (name) {
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(name)) {
      throw new TemplateError(`Template name must be "name" or "dir/name", got ${JSON.stringify(name)}`)
    }
    const file = path.join(this.templatePath, `${name}.html`)
    if (!fs.existsSync(file)) {
      throw new TemplateError(`No such template: ${name} (looked in ${file})`)
    }
    return file
  }

  /** Raw template text, cached until the file changes on disk. */
  template (name) {
    const file = this.#resolve(name)
    const mtime = fs.statSync(file).mtimeMs
    const cached = this.cache.get(name)
    if (cached && cached.mtime === mtime) return cached.text
    const text = fs.readFileSync(file, 'utf8')
    this.cache.set(name, { mtime, text })
    return text
  }

  /** The placeholder names a template uses, escaped and raw alike. */
  placeholders (name) {
    return new Set([...this.template(name).matchAll(PLACEHOLDER)].map(m => m[1] ?? m[2]))
  }

  /** Fill a template. */
  render (name, values = {}) {
    const template = this.template(name)
    const required = this.placeholders(name)
    const supplied = new Set(Object.keys(values))

    const missing = [...required].filter(key => !supplied.has(key))
    if (missing.length) {
      throw new TemplateError(
        `Template ${name} needs values not supplied: ${missing.join(', ')}. ` +
        'An unsupplied value would render an empty region of the page and say nothing.'
      )
    }
    const unused = [...supplied].filter(key => !required.has(key))
    if (unused.length) {
      throw new TemplateError(
        `Template ${name} was given values it does not use: ${unused.join(', ')}. ` +
        'This usually means the template or the caller has drifted.'
      )
    }

    return template.replace(PLACEHOLDER, (_match, raw, escaped) =>
      raw !== undefined ? String(values[raw] ?? '') : escape(values[escaped]))
  }

  /** Fill one template once per item and join. This is what replaces a loop. */
  each (name, items, valuesFor) {
    return items.map(item => this.render(name, valuesFor(item))).join('\n')
  }

  /** A fragment, or nothing at all. This is what replaces a conditional. */
  when (condition, name, values) {
    return condition ? this.render(name, values) : ''
  }

  /**
   * A non-HTML file from the same directory, verbatim.
   *
   * The stylesheet, chiefly. It lived as a JavaScript template literal, where a
   * backtick inside a CSS comment ended the string and broke the build — a
   * failure mode a `.css` file does not have, and an editor can check what it
   * cannot check inside a string.
   */
  asset (filename) {
    if (!/^[a-z0-9-]+\.[a-z]+$/.test(filename)) {
      throw new TemplateError(`Asset name must be a plain filename, got ${JSON.stringify(filename)}`)
    }
    const file = path.join(this.templatePath, filename)
    if (!fs.existsSync(file)) throw new TemplateError(`No such asset: ${filename}`)
    const mtime = fs.statSync(file).mtimeMs
    const cached = this.cache.get(filename)
    if (cached && cached.mtime === mtime) return cached.text
    const text = fs.readFileSync(file, 'utf8')
    this.cache.set(filename, { mtime, text })
    return text
  }

  /** Every template on disk. Used by a test to assert each one is reachable. */
  list () {
    const names = []
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${entry.name}/`)
        else if (entry.name.endsWith('.html')) names.push(`${prefix}${entry.name.replace(/\.html$/, '')}`)
      }
    }
    walk(this.templatePath, '')
    return names.sort()
  }
}

/** One instance is enough: templates are read from disk and cached by mtime. */
export const templates = new Templates()

export default templates
