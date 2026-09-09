import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { STATIC_FILES } from '../../src/api/server.js'
import { PAGES } from '../../src/api/pages.js'
import { HARVEST_CONFIG } from '../../config/preferences.js'

/**
 * `/robots.txt`.
 *
 * A crawler reads a 404 here as permission, so the file is not strictly
 * needed — but this project runs a crawler of its own and asks other sites to
 * be legible about what they permit. Publishing nothing while expecting others
 * to publish something is the wrong way round.
 *
 * What is asserted below is mostly what must *not* be in it. A robots.txt is
 * public, so a `Disallow` line is an advertisement: listing a private path
 * tells everyone it exists. And a rule that accidentally covers the catalogue
 * would delist 752 plugin pages silently, which is the kind of failure nobody
 * notices for a month.
 */

const ROBOTS = fs.readFileSync('robots.txt', 'utf8')
const directives = ROBOTS.split('\n')
  .map(line => line.replace(/#.*$/, '').trim())
  .filter(Boolean)
/** The values of one directive. Names are case-insensitive in robots.txt. */
const valuesOf = name => directives
  .filter(line => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
  .map(line => line.slice(name.length + 1).trim())

describe('the file itself', () => {
  it('is the file the route serves', () => {
    // The recurring pattern: a route and the thing it reads, with nothing
    // connecting them.
    expect(STATIC_FILES['/robots.txt'].file).toBe('robots.txt')
    expect(fs.existsSync(STATIC_FILES['/robots.txt'].file)).toBe(true)
  })

  it('is served as plain text', () => {
    // text/html would be ignored by most crawlers.
    expect(STATIC_FILES['/robots.txt'].type).toMatch(/^text\/plain/)
  })

  it('reaches the image', () => {
    // `.dockerignore` excluded docs/ once, after the app started serving pages
    // from it, and the only symptom was 500s on three routes in production.
    const ignored = fs.readFileSync('.dockerignore', 'utf8')
      .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    for (const rule of ignored) {
      expect(rule.replace(/^!/, ''), `.dockerignore excludes ${rule}`).not.toBe('robots.txt')
    }
  })

  it('opens with a group every crawler matches', () => {
    expect(valuesOf('User-agent')).toContain('*')
  })
})

/**
 * Does a rule match a path?
 *
 * robots.txt matching is a prefix match with two wildcards: `*` for any run of
 * characters and a trailing `$` to anchor the end. A plain string prefix — the
 * first thing written here — says `/*?q=` blocks `/about`, which is wrong in
 * the direction that matters: it would have passed a file that delisted the
 * prose pages.
 */
function matches (rule, path) {
  const anchored = rule.endsWith('$')
  const body = anchored ? rule.slice(0, -1) : rule
  const pattern = body
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path)
}

/** Longest matching rule wins; ties go to Allow. What crawlers actually do. */
function isAllowed (path) {
  const best = (name, fallback) => valuesOf(name)
    .filter(rule => matches(rule, path))
    .reduce((longest, rule) => (rule.length > longest.length ? rule : longest), fallback)
  const allow = best('Allow', '')
  const disallow = best('Disallow', '')
  if (!disallow) return true
  return allow.length >= disallow.length
}

describe('what it permits', () => {
  it('matches the way a crawler matches', () => {
    // The helper above is doing the work, so it is worth proving it works.
    expect(matches('/*?q=', '/about')).toBe(false)
    expect(matches('/*?q=', '/?q=reverb')).toBe(true)
    expect(matches('/auth/', '/auth/login')).toBe(true)
    expect(matches('/auth/', '/about')).toBe(false)
  })

  it('lets the catalogue be crawled, which is the entire point', () => {
    for (const path of [
      '/', '/plugin/wet-reverb-693085a0', '/plugin/wet-reverb-693085a0.ttl',
      '/category/reverb', '/category/reverb.ttl', '/ns', '/ns/plugin-universe.ttl'
    ]) {
      expect(isAllowed(path), `robots.txt blocks ${path}`).toBe(true)
    }
  })

  it('leaves the prose pages crawlable, including the crawler contact page', () => {
    // /about/crawler is the address this project's own user agent advertises to
    // every source it has ever fetched from. Hiding it would be absurd.
    for (const route of Object.keys(PAGES)) {
      expect(isAllowed(route), `robots.txt blocks ${route}`).toBe(true)
    }
  })

  it('keeps crawlers out of the unbounded query space', () => {
    // Every distinct search string is another URL that exists only because it
    // was asked for, and nothing is reachable there that a category page does
    // not already link.
    expect(isAllowed('/search?q=reverb')).toBe(false)
    expect(isAllowed('/?q=reverb')).toBe(false)
    expect(isAllowed('/?format=VST3&from=30')).toBe(false)
  })

  it('keeps the plain paging of the front listing reachable', () => {
    // Otherwise only page one is crawlable, and the couple of plugins that
    // carry no category are unreachable from anywhere. This is the case that
    // needs longest-match to be honoured, so it is the one worth asserting.
    expect(isAllowed('/?from=10')).toBe(true)
  })

  it('does not send a crawler through the sign-in flow', () => {
    expect(isAllowed('/auth/login')).toBe(false)
  })
})

describe('what it must not give away', () => {
  it('names no path that is meant to be unlisted', () => {
    // robots.txt is public and a Disallow line is an advertisement. /moderation
    // answers 404 to a stranger precisely so that its existence is not
    // announced; naming it here would undo that.
    for (const secret of ['/moderation', '/admin', '/health']) {
      expect(ROBOTS, `robots.txt advertises ${secret}`).not.toContain(secret)
    }
  })

  it('points at a contact page rather than an address', () => {
    // Same rule the crawler policy asks of others, and no email in a file that
    // is scraped by everything.
    const promised = HARVEST_CONFIG.userAgent.match(/\+(https?:\/\/[^)]+)/)[1]
    expect(ROBOTS).toContain(promised)
    expect(ROBOTS, 'an email address in robots.txt is an invitation to spam').not.toMatch(/@/)
  })

  it('promises no sitemap until there is one', () => {
    // A Sitemap: line naming a URL that 404s is the same defect as a user agent
    // advertising a contact page that does not exist. When a sitemap is built,
    // this assertion is what to change.
    expect(ROBOTS.toLowerCase()).not.toContain('sitemap:')
  })
})
