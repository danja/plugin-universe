import dns from 'node:dns/promises'
import net from 'node:net'
import HttpSource from '../harvest/HttpSource.js'
import { SUBMITTABLE, PLUGIN_FORMATS } from './Submissions.js'
import { toKnownSpdx } from '../harvest/Licensing.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * Read one page, at a moderator's request, into a draft submission.
 *
 * Somebody pasting the URL of their plugin's page is asking for one document to
 * be read once. `docs/resources.md` §4 rule 8 sets out why that is a different
 * act from crawling — consent and scale — and, more usefully, what would turn
 * it back into crawling. Those four things are refused here in code rather than
 * in policy:
 *
 *  - **One URL.** `read()` fetches exactly one and has no loop.
 *  - **No link-following.** The document is parsed, never walked. Nothing in
 *    this file issues a second request, and a redirect is reported rather than
 *    followed, because the address that was vetted is not the address a
 *    redirect leads to.
 *  - **No schedule.** There is no cache, no retry-later, no queue. It runs when
 *    a person presses the button.
 *  - **Moderators only**, enforced at the route. An open form is an open proxy,
 *    and "a person asked for it" stops being true the moment anyone can ask.
 *
 * What comes back is a **draft**, never a write. What a page says about itself
 * is a claim, and the submission queue already exists to hold claims until
 * somebody reviews them. Every field carries where it came from so the
 * moderator can weigh it — `og:title` and "a word we saw in the prose" do not
 * deserve equal trust, and the form should not pretend otherwise.
 */

export class PageReadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PageReadError'
  }
}

/**
 * Addresses this server must not be talked into fetching.
 *
 * The feature makes the server issue a request chosen by someone else, which is
 * the shape of every SSRF. The thing worth protecting is specific and nearby:
 * Fuseki's update endpoint binds to 127.0.0.1 and publishing it by accident is
 * named in CLAUDE.md as the worst mistake available here. A moderator pasting
 * `http://127.0.0.1:3030/...` — by mistake or because somebody talked them into
 * it — must not reach it.
 *
 * Cloud metadata services (169.254.169.254) are in the link-local range and
 * excluded by the same check.
 */
function isPrivateAddress (address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, and cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    return false
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase()
    if (value === '::1' || value === '::') return true
    if (value.startsWith('fe80:')) return true // link-local
    if (/^f[cd]/.test(value)) return true // unique local
    // An IPv4-mapped address is an IPv4 address wearing a hat.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }
  return true
}

/**
 * Check a URL is one this server may be asked to fetch.
 *
 * Resolved rather than pattern-matched, because `localtest.me` and a thousand
 * names like it resolve to 127.0.0.1 and look nothing like it.
 *
 * **This is checked before the fetch and the name is resolved again by the
 * fetch itself**, so a name that changes its answer in between would slip
 * through. Closing that needs the connection pinned to the address that was
 * vetted, which Node's fetch does not offer. It is recorded rather than
 * papered over: the feature is moderators-only, one request, no body returned
 * to the caller, and the draft is reviewed by a person before anything is
 * written — so the value of winning that race is low.
 */
export async function checkFetchable (raw) {
  let url
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new PageReadError('That is not a URL. Paste the full address, starting http:// or https://.')
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new PageReadError(`This reads http and https pages. "${url.protocol}" is not one of them.`)
  }
  if (url.username || url.password) {
    throw new PageReadError('Remove the username and password from the URL. This fetch does not sign in as anyone.')
  }

  let addresses
  try {
    addresses = await dns.lookup(url.hostname, { all: true })
  } catch {
    throw new PageReadError(`No such host: ${url.hostname}. Check the address.`)
  }
  // Every address, not the first: a name resolving to one public and one
  // private address is the interesting case, not an edge one.
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new PageReadError(
      `${url.hostname} resolves to a private address. This fetches public pages only — ` +
      'the catalogue\'s own services are on those addresses and are not somewhere to point it.')
  }
  return url
}

/** Tags stripped whole: their text is code or styling, never prose. */
const NON_PROSE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi

const ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'"
})

function decodeEntities (text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase()
    if (ENTITIES[key]) return ENTITIES[key]
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)))
    return whole
  })
}

function clean (value) {
  if (typeof value !== 'string') return null
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim()
  return text.length ? text.slice(0, CONTRIBUTION_CONFIG.maxValueLength) : null
}

/** `<meta>` content by property or name, whichever the page used. */
function metaContent (html, key) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i')
  const tag = html.match(pattern)?.[0]
  if (!tag) return null
  return clean(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1])
}

/**
 * schema.org objects the page published about itself.
 *
 * The most trustworthy thing on a page, because it is the only part written to
 * be read by a machine — everything else here is inference from prose meant for
 * a person.
 */
function jsonLdObjects (html) {
  const found = []
  const blocks = html.matchAll(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const [, body] of blocks) {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      // A page with broken JSON-LD is a page that has other metadata. Not an
      // error: nothing here is required.
      continue
    }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed]
    while (queue.length) {
      const node = queue.shift()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph'])
      found.push(node)
    }
  }
  return found
}

/** The schema.org types that describe something installable. */
const SOFTWARE_TYPES = /SoftwareApplication|SoftwareSourceCode|Product|WebApplication/i

function typeOf (node) {
  const type = node['@type']
  return Array.isArray(type) ? type.join(' ') : String(type ?? '')
}

/** A schema.org value that may be a string, an object with a name, or a list. */
function nameOf (value) {
  if (typeof value === 'string') return clean(value)
  if (Array.isArray(value)) return nameOf(value[0])
  if (value && typeof value === 'object') return clean(value.name ?? value['@id'])
  return null
}

/**
 * Formats named in the page.
 *
 * Word-bounded and case-sensitive where the name needs it: "VST3" is
 * unambiguous, but a bare "AU" matches half the prose in any language, and
 * "Standalone" as an adjective is not a claim that a standalone build exists.
 * So the loose ones are left out, and the moderator ticks the box.
 */
const FORMAT_PATTERNS = Object.freeze([
  [/\bVST3\b/i, 'VST3'],
  [/\bVST2\b|\bVST\s*2\.\d\b/i, 'VST2'],
  [/\bCLAP\b/, 'CLAP'],
  [/\bLV2\b/i, 'LV2'],
  [/\bLADSPA\b/i, 'LADSPA'],
  [/\bAAX\b/, 'AAX'],
  [/\bAudio\s*Unit\s*(?:v?3|3)\b/i, 'AudioUnitV3'],
  [/\bAudio\s*Units?\b/i, 'AudioUnit']
])

function formatsIn (text) {
  const found = []
  for (const [pattern, format] of FORMAT_PATTERNS) {
    if (pattern.test(text)) found.push(format)
  }
  // AudioUnitV3 implies the page discusses Audio Units; listing both from one
  // mention would be the reader inventing a build.
  if (found.includes('AudioUnitV3') && found.includes('AudioUnit') &&
      !/\bAudio\s*Units?\b(?!\s*v?3)/i.test(text)) {
    return found.filter(name => name !== 'AudioUnit')
  }
  return found.filter(name => PLUGIN_FORMATS.includes(name))
}

/** An SPDX identifier the page states, in its metadata or in a link. */
function licenceIn (html, nodes) {
  for (const node of nodes) {
    const stated = nameOf(node.license ?? node.licence)
    const spdx = stated && toKnownSpdx(stated)
    if (spdx) return { value: spdx, from: 'schema.org license' }
  }
  const link = html.match(/https?:\/\/[^\s"'<>]*(?:spdx\.org\/licenses|opensource\.org\/licenses|gnu\.org\/licenses|creativecommons\.org\/publicdomain)[^\s"'<>]*/i)
  const fromLink = link && toKnownSpdx(link[0])
  if (fromLink) return { value: fromLink, from: 'a licence link on the page' }
  return null
}

/**
 * The visible prose of a page, with the markup taken out.
 *
 * Only ever used to look for format names and a licence. It is not stored and
 * not shown — reproducing somebody's page is the thing rule 5 rules out.
 */
function visibleText (html) {
  return decodeEntities(html.replace(NON_PROSE, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .slice(0, 200000)
}

/**
 * Turn one fetched document into a draft submission.
 *
 * Exported separately from `read()` so the extraction can be tested against
 * saved pages without a network — the fetch is the part that needs the network,
 * and it is three lines.
 *
 * @returns {{fields: object, sources: object, notes: string[]}}
 *   `fields` keyed as `SUBMITTABLE` is, `sources` saying where each came from,
 *   and `notes` for what a moderator should look at.
 */
export function draftFrom (html, url) {
  const nodes = jsonLdObjects(html)
  const software = nodes.filter(node => SOFTWARE_TYPES.test(typeOf(node)))
  // A page about one plugin usually has one; a listing page has several, and
  // that is worth saying rather than silently taking the first.
  const primary = software[0] ?? nodes[0] ?? {}

  const fields = {}
  const sources = {}
  const notes = []

  const set = (key, value, from) => {
    if (value === null || value === undefined || fields[key] !== undefined) return
    if (Array.isArray(value) ? value.length === 0 : String(value).length === 0) return
    fields[key] = value
    sources[key] = from
  }

  set('name', nameOf(primary.name), 'schema.org name')
  set('name', metaContent(html, 'og:title'), 'og:title')
  set('name', clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]), '<title>')

  set('description', clean(primary.description), 'schema.org description')
  set('description', metaContent(html, 'og:description'), 'og:description')
  set('description', metaContent(html, 'description'), '<meta name="description">')

  set('vendor', nameOf(primary.author ?? primary.publisher ?? primary.creator),
    'schema.org author')
  set('vendor', metaContent(html, 'og:site_name'), 'og:site_name')

  // The URL the person pasted, not one found in the page: it is what they are
  // vouching for, and a canonical link is the page talking about itself.
  set('homepage', url, 'the URL you pasted')

  const text = `${visibleText(html)} ${url}`
  set('format', formatsIn(text), 'format names in the page')

  const licence = licenceIn(html, nodes)
  if (licence) set('licenceId', licence.value, licence.from)

  if (software.length > 1) {
    notes.push(
      `The page describes ${software.length} pieces of software. This drafted the first — ` +
      'check it is the one you meant.')
  }
  if (!fields.format) {
    notes.push('No plugin format was named on the page. Tick the ones it is built for.')
  }
  if (!fields.licenceId) {
    notes.push('No licence identifier was found. Add one if you know it.')
  }
  if (fields.name && fields.vendor && fields.name === fields.vendor) {
    notes.push('The name and the vendor came out the same, which usually means the page title is a site name.')
  }
  for (const key of Object.keys(SUBMITTABLE)) {
    if (SUBMITTABLE[key].required && fields[key] === undefined) {
      notes.push(`${SUBMITTABLE[key].label} could not be read from the page, and is needed.`)
    }
  }

  return { fields, sources, notes }
}

export class PageReader {
  constructor ({ http = new HttpSource(), maxBytes = 2 * 1024 * 1024 } = {}) {
    this.http = http
    this.maxBytes = maxBytes
  }

  /**
   * Fetch one page and draft a submission from it.
   *
   * The whole of the network activity in this feature. There is no second
   * request anywhere below it.
   */
  async read (raw) {
    const url = await checkFetchable(raw)
    let html
    try {
      html = await this.http.fetchText(url.href, {
        accept: 'text/html, application/xhtml+xml',
        maxBytes: this.maxBytes,
        // Reported, not followed: the address vetted above is not the address
        // a redirect leads to, and re-vetting it here would be the second
        // request this must not make.
        redirect: 'manual'
      })
    } catch (error) {
      throw new PageReadError(`Could not read ${url.href}: ${error.message}`)
    }
    const draft = draftFrom(html, url.href)
    return { ...draft, url: url.href }
  }
}

export default PageReader
