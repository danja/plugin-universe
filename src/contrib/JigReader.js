import { Readable } from 'stream'
import { rdfParser } from 'rdf-parse'
import rdf from 'rdf-ext'
import HttpSource from '../harvest/HttpSource.js'
import { SUBMITTABLE } from './Submissions.js'
import { readProfile, ProfileError } from './ProfileDocument.js'
import { checkFetchable, PageReadError } from './PageReader.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Fetch a JigDAW plugin or collection by URL, into drafts.
 *
 * Anybody signed in may paste the address of a plugin's own IRI — fetching it
 * is installing it, so its profile answers — or of a collection `.ttl`, and
 * have this server copy the profile into the submission form for checking.
 * Nothing is written: the ordinary Submit button is still what saves, through
 * the same validator, shapes and serialiser as a typed submission.
 *
 * The fetch defences are `PageReader`'s, reused rather than reimplemented:
 * every address is vetted against the private ranges before it is fetched, a
 * redirect is reported rather than followed, and each body is bounded. What is
 * different is said plainly:
 *
 *  - **RDF only.** This box does not read HTML pages at all — an address that
 *    returns one is refused with a message saying so. Reading prose off pages
 *    stays the moderator-only box, because inferring facts from prose is the
 *    part that needs a moderator's judgement.
 *  - **A collection names its members, and each is fetched once.** That is one
 *    plus N requests rather than one, capped by
 *    `CONTRIBUTION_CONFIG.jigCollectionMembers` and refused whole past it. No
 *    member is walked beyond its profile, nothing is fetched at load time, and
 *    a member that fails is reported beside its name rather than stopping the
 *    others — the same independence the collection spec gives a host.
 */

const jig = NAMESPACES.jig
const trn = NAMESPACES.trn
const rdfs = NAMESPACES.rdfs
const rdfNs = NAMESPACES.rdf
const DCTERMS = 'http://purl.org/dc/terms/'

export class JigReadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'JigReadError'
  }
}

/**
 * Whether what came back is an HTML document rather than RDF.
 *
 * The same positive recognition `PageReader` uses: a doctype or one of the
 * three elements every HTML document has in the opening kilobyte. A Turtle
 * document has no comparable marker, so RDF is the default and HTML must
 * announce itself.
 */
function looksLikeHtml (body) {
  const start = String(body ?? '').trimStart().slice(0, 1000).toLowerCase()
  if (start.startsWith('<!doctype html')) return true
  return /<(html|head|body)[\s>]/.test(start)
}

/** Parse Turtle or JSON-LD, told apart by looking as `readProfile` does. */
async function parseDataset (body, baseIRI) {
  const text = String(body ?? '').trim()
  if (!text) throw new JigReadError('Nothing came back from that address. Check it and try again.')
  const looksJson = text.startsWith('{') || text.startsWith('[')
  const quads = []
  try {
    await new Promise((resolve, reject) => {
      rdfParser.parse(Readable.from([text]), {
        contentType: looksJson ? 'application/ld+json' : 'text/turtle',
        baseIRI
      })
        .on('data', quad => quads.push(quad))
        .on('error', reject)
        .on('end', resolve)
    })
  } catch (error) {
    throw new JigReadError(
      `That does not parse as ${looksJson ? 'JSON-LD' : 'Turtle'}: ${String(error.message).split('\n')[0]}`)
  }
  return rdf.dataset(quads)
}

/** Subjects typed as a plugin collection, in either vocabulary. */
function collectionSubjects (dataset) {
  const found = new Set()
  for (const quad of dataset) {
    if (quad.predicate.value !== `${rdfNs}type`) continue
    if (quad.object.value === `${jig}PluginCollection` ||
        quad.object.value === `${trn}PluginCollection`) {
      found.add(quad.subject.value)
    }
  }
  return [...found]
}

/** Whether this profile subject is a JigDAW web plugin. */
function isWebPlugin (dataset, subject) {
  for (const quad of dataset) {
    if (quad.subject.value === subject &&
        quad.predicate.value === `${rdfNs}type` &&
        quad.object.value === `${jig}WebPlugin`) {
      return true
    }
  }
  return false
}

/**
 * A draft that says Jig, because the profile is one.
 *
 * Profiles in the wild declare `trn:format trn:WebAudio` — the generic
 * technology — while the catalogue's format for them is `trn:Jig`. The type
 * statement is the evidence, so a `jig:WebPlugin` gains Jig the way
 * `JigDawHarvester` adds it at ingest. Anything already declared is kept.
 */
function withJigFormat (draft, dataset, subject) {
  if (!isWebPlugin(dataset, subject)) return draft
  const formats = new Set([draft.fields.format ?? []].flat())
  if (formats.has('Jig')) return draft
  formats.add('Jig')
  return {
    ...draft,
    fields: { ...draft.fields, format: [...formats] },
    sources: {
      ...draft.sources,
      format: draft.sources.format
        ? `${draft.sources.format}, plus Jig for its jig:WebPlugin type`
        : 'its jig:WebPlugin type'
    }
  }
}

export class JigReader {
  constructor ({ http = new HttpSource(), maxBytes = 2 * 1024 * 1024 } = {}) {
    this.http = http
    this.maxBytes = maxBytes
    this.maxMembers = CONTRIBUTION_CONFIG.jigCollectionMembers
  }

  /**
   * Fetch one address and draft what it points at.
   *
   * @returns {{url: string, kind: 'plugin', draft: object}} for a profile, or
   *   {{url: string, kind: 'collection', collection: object, members: object[]}}
   *   for one — each member carrying either a `draft` or an `error`, so a dead
   *   link in a collection does not stop the rest being offered.
   */
  async read (raw, { submittable = SUBMITTABLE } = {}) {
    let url
    try {
      url = await checkFetchable(raw)
    } catch (error) {
      if (!(error instanceof PageReadError)) throw error
      throw new JigReadError(error.message)
    }

    let body
    try {
      body = await this.http.fetchText(url.href, {
        // Profiles, not pages: a server that negotiates offers the Turtle, and
        // anything arriving as HTML is refused below rather than scraped.
        accept: 'text/turtle, application/ld+json',
        maxBytes: this.maxBytes,
        // Reported, not followed: the address vetted above is not the address
        // a redirect leads to.
        redirect: 'manual'
      })
    } catch (error) {
      throw new JigReadError(`Could not read ${url.href}: ${error.message}`)
    }

    if (looksLikeHtml(body)) {
      throw new JigReadError(
        `${url.href} returned a page, not a profile. This reads a plugin's own address ` +
        '(which serves its profile) or a collection .ttl — to draft from an ordinary page, ' +
        'ask a moderator.')
    }

    const dataset = await parseDataset(body, url.href)
    const collections = collectionSubjects(dataset)
    if (collections.length > 1) {
      throw new JigReadError(
        `That document names ${collections.length} collections. A collection file holds one — ` +
        'submit one at a time.')
    }
    if (collections.length === 1) {
      return this.#readCollection(url.href, dataset, submittable)
    }
    return this.#readPlugin(url.href, body, dataset, submittable)
  }

  async #readPlugin (url, body, dataset, submittable) {
    let draft
    try {
      draft = await readProfile(body, { submittable, baseIRI: url })
    } catch (error) {
      if (!(error instanceof ProfileError)) throw error
      throw new JigReadError(`${url} is not a plugin profile, and ${lower(error.message)}`)
    }
    const subject = draft.subject
    return { url, kind: 'plugin', draft: { ...withJigFormat(draft, dataset, subject), url } }
  }

  async #readCollection (url, dataset, submittable) {
    const [subject] = collectionSubjects(dataset)
    const value = predicate => {
      for (const quad of dataset) {
        if (quad.subject.value === subject && quad.predicate.value === predicate) {
          return quad.object.value
        }
      }
      return null
    }
    const members = []
    const seen = new Set()
    for (const quad of dataset) {
      if (quad.subject.value !== subject) continue
      if (quad.predicate.value !== `${DCTERMS}hasPart`) continue
      // A plugin IRI, not a blank node: the spec names members by IRI, and a
      // blank node names nothing fetchable.
      if (quad.object.termType !== 'NamedNode' || seen.has(quad.object.value)) continue
      seen.add(quad.object.value)
      members.push(quad.object.value)
    }
    if (members.length === 0) {
      throw new JigReadError(`${url} is a collection that names no plugins. Nothing to draft.`)
    }
    if (members.length > this.maxMembers) {
      throw new JigReadError(
        `${url} names ${members.length} plugins, over the ${this.maxMembers} this reads in one go. ` +
        'Submit plugins from it one address at a time instead.')
    }

    const labelOf = iri => {
      for (const quad of dataset) {
        if (quad.subject.value === iri && quad.predicate.value === `${rdfs}label`) {
          return quad.object.value
        }
      }
      return iri.split('/').filter(Boolean).pop() ?? iri
    }
    const collection = {
      url,
      label: value(`${rdfs}label`) ?? url,
      comment: value(`${rdfs}comment`) ?? ''
    }

    // One at a time, in order: a collection is fetched because a person asked,
    // not harvested on a schedule, and forty parallel fetches at one press is
    // the burst the politeness rules exist to prevent.
    const read = []
    for (const iri of members) {
      read.push(await this.#readMember(iri, labelOf(iri), submittable))
    }
    return { url, kind: 'collection', collection, members: read }
  }

  async #readMember (iri, name, submittable) {
    let url
    try {
      url = await checkFetchable(iri)
    } catch (error) {
      return { url: iri, name, error: error instanceof PageReadError ? error.message : String(error.message ?? error) }
    }
    let body
    try {
      body = await this.http.fetchText(url.href, {
        accept: 'text/turtle, application/ld+json',
        maxBytes: this.maxBytes,
        redirect: 'manual'
      })
    } catch (error) {
      return { url: iri, name, error: `Could not read ${url.href}: ${error.message}` }
    }
    if (looksLikeHtml(body)) {
      return { url: iri, name, error: `${url.href} returned a page, not a profile.` }
    }
    let dataset
    try {
      dataset = await parseDataset(body, url.href)
    } catch (error) {
      return { url: iri, name, error: error instanceof JigReadError ? error.message : String(error.message ?? error) }
    }
    try {
      const draft = await readProfile(body, { submittable, baseIRI: url.href })
      return {
        url: url.href,
        name: draft.fields.name ?? name,
        draft: { ...withJigFormat(draft, dataset, draft.subject), url: url.href }
      }
    } catch (error) {
      return {
        url: url.href,
        name,
        error: error instanceof ProfileError
          ? `${url.href} is not a plugin profile, and ${lower(error.message)}`
          : String(error.message ?? error)
      }
    }
  }
}

/** A sentence fragment: "... and that does not parse as Turtle". */
function lower (message) {
  const text = String(message ?? '')
  return text.charAt(0).toLowerCase() + text.slice(1)
}

export default JigReader
