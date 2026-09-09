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

const RENDER = fs.readFileSync('src/api/render.js', 'utf8')
const SERVER = fs.readFileSync('src/api/server.js', 'utf8')

/** The `case '/x':` labels of the dispatch switch. */
const STATIC_ROUTES = new Set(
  [...SERVER.matchAll(/case '(\/[^']*)':/g)].map(match => match[1])
)

/**
 * The dynamic routes, read from the `path.match(...)` calls that implement
 * them, so this cannot drift from the dispatcher the way a second copy would.
 */
const DYNAMIC_ROUTES = [...SERVER.matchAll(/path\.match\((\/.*\/)\)\s*$/gm)]
  .map(match => new RegExp(match[1].slice(1, -1)))

/** Replace each `${...}` — brace-matched, they nest — with a sample value. */
function substitute (template) {
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
    expect(linkedPaths().length).toBeGreaterThan(5)
  })

  it('serves every one of them', () => {
    const broken = linkedPaths().filter(path => !served(path))
    expect(
      broken,
      `src/api/render.js links to ${broken.join(', ')}, which src/api/server.js does not serve.`
    ).toEqual([])
  })

  it('links the moderation queue, which is otherwise reachable only by guessing', () => {
    expect(linkedPaths()).toContain('/moderation')
  })
})
