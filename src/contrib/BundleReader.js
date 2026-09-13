import { checkFetchable, PageReadError } from './PageReader.js'
import HttpSource from '../harvest/HttpSource.js'
import { parseTurtle, ParseError } from '../harvest/TurtleReader.js'
import { readBundleDataset } from '../harvest/Lv2Bundle.js'
import rdf from 'rdf-ext'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * "Send us the URL of your bundle and it is read from there."
 *
 * `/about/profiles` has made that offer since the profile form shipped, and
 * nothing acted on it until now — a published promise with no code behind it,
 * which is the class of defect this project keeps writing down.
 *
 * It is deliberately the *narrowest* thing that makes the sentence true.
 *
 * **One fetch, of one Turtle file, at a named moderator's request.**
 * `docs/sources.md` §4 rule 8 is what bounds the moderator URL fetch on
 * `/submit`, and every clause of it applies here for the same reasons: the
 * request has to stay attributable to a person, it must not follow links, and
 * the result is a draft for a human rather than a write. Reusing
 * `checkFetchable` rather than writing a second set of defences is the point —
 * it is the same threat (a server issuing a request somebody else chose) and
 * one implementation of the answer.
 *
 * **A bundle is several files and this reads one.** An LV2 bundle is a
 * `manifest.ttl` pointing at a plugin's own `.ttl`, and following that pointer
 * would be a second fetch — link-following, which rule 8 forbids. So this asks
 * for the file that actually holds the ports, and says so when it is handed a
 * manifest instead. Reading a whole bundle, or a repository, needs the sanctioned
 * API path rather than this one.
 *
 * **It reads; it does not write.** What comes back is a record for a moderator
 * to look at and apply, which is what keeps a fetched document from being an
 * unreviewed contribution.
 */

/** Turtle is generous about size; a bundle description is not a dataset. */
const MAX_BYTES = 512 * 1024

export class BundleReadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'BundleReadError'
  }
}

export class BundleReader {
  constructor ({ http = new HttpSource() } = {}) {
    this.http = http
  }

  /**
   * Read one Turtle file and return the plugins it describes.
   *
   * @param {string} raw - the URL as a person typed it
   * @returns {Promise<{url: string, plugins: object[]}>}
   */
  async read (raw) {
    // The same four refusals the submission form's reader makes: a URL that is
    // not http(s), one that resolves to a private address, one that redirects
    // somewhere it should not, and one this instance is not allowed to fetch.
    let url
    try {
      url = await checkFetchable(raw)
    } catch (error) {
      if (error instanceof PageReadError) throw new BundleReadError(error.message)
      throw error
    }

    let text
    try {
      text = await this.http.fetchText(url.href, {
        accept: 'text/turtle, application/x-turtle, text/plain',
        maxBytes: MAX_BYTES,
        // `checkFetchable` has already decided where this URL points; following
        // a redirect would land somewhere it never checked.
        redirect: 'manual'
      })
    } catch (error) {
      throw new BundleReadError(`Could not read ${url.href}: ${error.message}`)
    }

    let dataset
    try {
      dataset = await parseTurtle(text, { baseIRI: url.href })
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      throw new BundleReadError(
        `That is not Turtle this can parse: ${error.message}. ` +
        'An LV2 plugin\'s own .ttl is what holds the ports.'
      )
    }

    // A manifest parses perfectly well and describes nothing: it is where
    // `a lv2:Plugin` lives, so the reader finds a plugin, with no ports, no
    // signals and no requirements. Passing that through would tell a moderator
    // "nothing the catalogue does not already have", which is true and useless.
    const plugins = readBundleDataset(typeAsPlugins(dataset)).filter(describesBehaviour)
    if (plugins.length === 0) {
      throw new BundleReadError(
        'No LV2 plugin with ports in that file. A bundle\'s manifest.ttl only names ' +
        'the plugin and points at its real description — send the URL of the .ttl ' +
        'that manifest\'s rdfs:seeAlso points to, which is where the ports are.'
      )
    }
    return { url: url.href, plugins }
  }
}

/**
 * Does this record actually say anything about how the plugin behaves?
 *
 * The test that tells a plugin's own description from its manifest. A manifest
 * names the plugin, types it and points at the real file; it parses cleanly and
 * carries no ports, so every one of these is empty.
 */
export function describesBehaviour (record) {
  return Boolean(
    record.parameters?.length ||
    record.accepts?.length ||
    record.produces?.length ||
    record.requires?.length
  )
}

/**
 * Type anything with ports as an `lv2:Plugin`, so one file can be read alone.
 *
 * This is the difference between reading a bundle from disk and reading one
 * file over HTTP, and it is not a detail — without it the feature fails on
 * every real LV2 bundle there is.
 *
 * An LV2 bundle splits itself in two. `manifest.ttl` says `<plugin> a lv2:Plugin`
 * and points at the real description with `rdfs:seeAlso`; the file it points at
 * carries the ports and types the plugin by its *subclass* — `lv2:AudioPlugin`,
 * `lv2:EffectPlugin` — and never as the bare class. `readBundleDataset` looks
 * for `lv2:Plugin`, which is correct when the harvester has read the whole
 * bundle into one dataset, and finds nothing at all in the file that has the
 * data.
 *
 * Following `rdfs:seeAlso` would be a second fetch, which rule 8 forbids. So
 * the missing assertion is supplied locally instead: a subject carrying
 * `lv2:port` is an LV2 plugin, which is exactly what the manifest would have
 * said. Nothing is written from this — it is a fact about the parsed dataset,
 * added so the existing reader can see what is in front of it.
 */
export function typeAsPlugins (dataset) {
  const type = rdf.namedNode(`${NAMESPACES.rdf}type`)
  const lv2Plugin = rdf.namedNode('http://lv2plug.in/ns/lv2core#Plugin')
  const port = rdf.namedNode('http://lv2plug.in/ns/lv2core#port')
  for (const quad of [...dataset.match(null, port, null)]) {
    if (dataset.match(quad.subject, type, lv2Plugin).size === 0) {
      dataset.add(rdf.quad(quad.subject, type, lv2Plugin))
    }
  }
  return dataset
}

/**
 * What a read would add to a plugin that is already in the catalogue.
 *
 * Additive only, and it says so in its shape: this returns what is *missing*,
 * never a replacement for something the catalogue already holds. A bundle is a
 * better source than a scrape for ports and signals — "discovery beats curation
 * for technical facts" — but a moderator reading a URL somebody sent them is
 * not discovery, and overwriting a measured or harvested fact on the strength
 * of a link in an email is not a trade this makes.
 */
export function additions (record, doc) {
  const missing = value => !value || value.length === 0
  return {
    parameters: missing(doc.parameters) ? record.parameters ?? [] : [],
    accepts: missing(doc.accepts) ? (record.accepts ?? []) : [],
    produces: missing(doc.produces) ? (record.produces ?? []) : [],
    requires: missing(doc.requires) ? (record.requires ?? []) : [],
    // Never additive: an upstream IRI is an identity claim, and this one came
    // from a file somebody chose rather than from a harvest of a known source.
    skipped: {
      parameters: missing(doc.parameters) ? 0 : (doc.parameters ?? []).length,
      accepts: missing(doc.accepts) ? 0 : (doc.accepts ?? []).length,
      produces: missing(doc.produces) ? 0 : (doc.produces ?? []).length,
      requires: missing(doc.requires) ? 0 : (doc.requires ?? []).length
    }
  }
}

/** How much of a plugin one read would fill in, as a sentence. */
export function summarise (added) {
  const parts = []
  if (added.parameters.length) parts.push(`${added.parameters.length} parameter${added.parameters.length === 1 ? '' : 's'}`)
  if (added.accepts.length) parts.push(`accepts ${added.accepts.length}`)
  if (added.produces.length) parts.push(`produces ${added.produces.length}`)
  if (added.requires.length) parts.push(`${added.requires.length} host requirement${added.requires.length === 1 ? '' : 's'}`)
  if (parts.length === 0) return 'nothing the catalogue does not already have'
  return parts.join(', ')
}

export default BundleReader
