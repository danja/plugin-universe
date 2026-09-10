import { describe, it, expect } from 'vitest'
import fs from 'fs'

/**
 * Every link the site renders must resolve to a route the server serves.
 *
 * This is the fifth instance of the pattern in CLAUDE.md — two files that have
 * to agree, with nothing connecting them. It has bitten in both directions: a
 * user agent advertising a contact page that 404d, and a moderation route that
 * worked but which nothing linked to, so the only way to reach the queue was to
 * know the URL.
 *
 * Scope, stated rather than implied: this checks links whose path is decided in
 * the template. A link built entirely out of a runtime value — the `.ttl` and
 * `.jsonld` alternatives, derived from a plugin's own IRI — has no static path
 * to check, and content negotiation is covered by tests/api/negotiate.test.js.
 */

/**
 * Everywhere a link can be written: the templates, and whatever HTML is still
 * assembled in code.
 *
 * When the page HTML moved out of `render.js` into `templates/`, this guard
 * kept reading `render.js` and found five links where there had been a dozen —
 * it went blind rather than red, which is the failure mode it exists to
 * prevent. It now reads both, and asserts it found enough to be doing its job.
 */
function sources () {
  const files = ['src/api/render.js', 'src/api/serialise.js']
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.html')) files.push(full)
    }
  }
  walk('templates')
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
}

const RENDER = sources()

/**
 * Every file that defines a route.
 *
 * `server.js` alone was enough until the wiki's routes moved to `src/wiki/`
 * with the rest of the wiki, at which point this guard reported three
 * perfectly good routes as broken. Naming files is what made it wrong twice —
 * once blind, once red — so it walks instead.
 */
function routeSources () {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  walk('src')
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
}

const SERVER = routeSources()

/** The `case '/x':` labels of the dispatch switch. */
const STATIC_ROUTES = new Set(
  [...SERVER.matchAll(/case '(\/[^']*)':/g)].map(match => match[1])
)

/**
 * The dynamic routes, read from the `path.match(...)` calls that implement
 * them, so this cannot drift from the dispatcher the way a second copy would.
 */
const DYNAMIC_ROUTES = [
  // `path.match(/…/)` in a router, and the exported `…_PATH` constants that a
  // feature's own route module uses instead.
  ...[...SERVER.matchAll(/path\.match\((\/.*\/)\)\s*$/gm)].map(match => match[1]),
  ...[...SERVER.matchAll(/^export const [A-Z_]*PATH = (\/.*\/)\s*$/gm)].map(match => match[1])
].map(source => new RegExp(source.slice(1, -1)))

/**
 * Replace each interpolation with a sample value.
 *
 * Two syntaxes now: `${...}` where HTML is still assembled in JavaScript, and
 * `{{name}}` / `{{{name}}}` in the templates. Missing the second made every
 * templated link look like a literal path containing braces.
 */
function substitute (template) {
  return substituteDollar(template)
    .replace(/\{\{\{?[a-zA-Z0-9_]+\}?\}\}/g, 'sample')
}

/** The `${...}` form, brace-matched because they nest. */
function substituteDollar (template) {
  let out = ''
  for (let i = 0; i < template.length; i++) {
    if (template[i] === '$' && template[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < template.length && depth > 0) {
        if (template[i] === '{') depth++
        else if (template[i] === '}') depth--
        i++
      }
      i--
      out += 'sample'
    } else {
      out += template[i]
    }
  }
  return out
}

/** The paths the renderer links to, as far as they are statically decidable. */
function linkedPaths () {
  const links = [...RENDER.matchAll(/(?:href|action)="([^"]*)"/g)].map(match => match[1])
  return [...new Set(
    links
      .map(substitute)
      .map(link => link.split(/[?#]/)[0])
      .filter(link => link.startsWith('/'))
  )]
}

const served = path => STATIC_ROUTES.has(path) || DYNAMIC_ROUTES.some(route => route.test(path))

describe('the routes the site links to', () => {
  it('reads the dispatcher rather than a second copy of it', () => {
    expect(STATIC_ROUTES.has('/health')).toBe(true)
    expect(DYNAMIC_ROUTES.length).toBeGreaterThanOrEqual(3)
  })

  it('discriminates — an invented path is not served', () => {
    // Otherwise a predicate that returned true for everything would pass the
    // test below while checking nothing.
    expect(served('/no-such-route')).toBe(false)
    expect(served('/plugin/sample/delete')).toBe(false)
  })

  it('finds links to check', () => {
    // Low is the tell that the guard has stopped looking where the links are.
    expect(linkedPaths().length).toBeGreaterThan(8)
  })

  it('reads the templates, which is where the markup now lives', () => {
    expect(RENDER).toContain('Plugin Universe')
    expect(RENDER.length).toBeGreaterThan(5000)
  })

  it('serves every one of them', () => {
    const broken = linkedPaths().filter(path => !served(path))
    expect(
      broken,
      `A template or renderer links to ${broken.join(', ')}, which nothing in src/ serves.`
    ).toEqual([])
  })

  it('links the moderation queue, which is otherwise reachable only by guessing', () => {
    expect(linkedPaths()).toContain('/moderation')
  })
})
