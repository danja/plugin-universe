import { createHash } from 'crypto'
import { NAMESPACES } from './NamespaceManager.js'

/**
 * IRI minting.
 *
 * IRIs live under http://purl.org/stuff/plugin-universe/ — a PURL that
 * redirects to whatever host currently serves the site. Identity is therefore
 * independent of the domain name, and a published IRI survives a change of
 * hosting. Never mint an IRI under the serving domain.
 *
 * Minting is a content hash over the identifying tuple, so re-harvesting the
 * same plugin produces the same IRI and ingest is idempotent for free.
 *
 * See docs/architecture.md §2.1.
 */

const TYPE_PATHS = Object.freeze({
  plugin: 'plugin',
  vendor: 'vendor',
  person: 'person',
  release: 'release',
  measurement: 'measurement',
  package: 'package',
  correction: 'correction',
  revision: 'revision',
  promotion: 'promotion'
})

/**
 * Unit separator. Cannot occur in an identity part, so ['a', 'bc'] and
 * ['ab', 'c'] cannot hash to the same value.
 */
const SEPARATOR = '\u001f'

export class URIMintError extends Error {
  constructor (message) {
    super(message)
    this.name = 'URIMintError'
  }
}

/** Lowercase, ASCII, hyphen-separated. Empty input is an error, not a default. */
export function slugify (text) {
  if (typeof text !== 'string') {
    throw new URIMintError(`Cannot slugify a ${typeof text}`)
  }
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) {
    throw new URIMintError(`Slug is empty after normalising: ${JSON.stringify(text)}`)
  }
  return slug
}

export class URIMinter {
  /**
   * @param {string} [base] - defaults to the pu: namespace
   */
  constructor (base = NAMESPACES.pu) {
    if (!base.endsWith('/')) throw new URIMintError(`Base IRI must end with "/": ${base}`)
    this.base = base
  }

  /**
   * Mint an IRI from a stable identifying tuple.
   *
   * @param {string} type - one of plugin, vendor, person, release, measurement, package
   * @param {string} label - human-readable name, used for the readable part of the IRI
   * @param {string[]} identity - the tuple that makes this thing this thing. Order matters
   *   and must be stable across harvests, or the IRI is not idempotent.
   */
  mint (type, label, identity) {
    const typePath = TYPE_PATHS[type]
    if (!typePath) {
      throw new URIMintError(`Unknown IRI type "${type}". Known: ${Object.keys(TYPE_PATHS).join(', ')}`)
    }
    if (!Array.isArray(identity) || identity.length === 0) {
      throw new URIMintError(`Minting a ${type} IRI needs a non-empty identity tuple`)
    }
    if (identity.some(part => part === null || part === undefined || part === '')) {
      throw new URIMintError(
        `Identity tuple for ${type} "${label}" contains an empty part: ${JSON.stringify(identity)}. ` +
        'An unstable tuple produces an unstable IRI; omit the field from the tuple instead.'
      )
    }
    const canonical = identity.map(String).join(SEPARATOR)
    const hash = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 8)
    return `${this.base}${typePath}/${slugify(label)}-${hash}`
  }

  /**
   * A plugin's identity is its vendor, its bundle name and, where the format
   * provides one, its class ID. Anything else (version, download URL, category)
   * changes over a plugin's life and must stay out of the tuple.
   *
   * Where the format gives a plugin a canonical IRI of its own and there is no
   * bundle to identify it by — LV2 is the case that matters — that IRI *is* the
   * identity, and using it is both more correct and more unique. Without this,
   * every LV2 plugin from one maintainer hashes to the same value, and any two
   * sharing a display name collapse into one catalogue entry.
   *
   * Bundle name and class ID are preferred over the canonical IRI when present,
   * so that the same VST3 harvested from two sources still deduplicates.
   *
   * A registry that supplies neither — the Open Audio Stack registry gives a
   * globally unique `organisation/package` slug and nothing else stable — is
   * identified by that slug alone. The vendor is deliberately not part of that
   * tuple: the slug already contains the organisation, while the display name
   * beside it is editorial and changes.
   *
   * The three branches are ranked, never mixed. A source that later starts
   * supplying a lower-ranked identifier therefore cannot silently renumber IRIs
   * already minted from a higher-ranked one.
   */
  mintPlugin ({ name, vendor, bundleName, classId, sourceIri, registryId }) {
    if (!name) throw new URIMintError('A plugin needs a name to mint an IRI')

    let identity = []
    if (bundleName || classId) identity = [vendor, bundleName, classId].filter(Boolean)
    else if (sourceIri) identity = [sourceIri, vendor].filter(Boolean)
    else if (registryId) identity = [registryId]

    if (identity.length === 0) {
      throw new URIMintError(
        `Cannot mint an IRI for plugin "${name}": need a bundleName, a classId, ` +
        'a canonical source IRI, or a registry id'
      )
    }
    return this.mint('plugin', name, identity)
  }

  mintVendor ({ name, homepage }) {
    if (!name) throw new URIMintError('A vendor needs a name to mint an IRI')
    return this.mint('vendor', name, [name, homepage].filter(Boolean))
  }

  /**
   * A measurement is identified by what was measured, with what, on what, when.
   * Two runs of the same tool on the same plugin are different measurements.
   */
  mintMeasurement ({ subject, tool, metric, platform, timestamp }) {
    for (const [key, value] of Object.entries({ subject, tool, metric, platform, timestamp })) {
      if (!value) throw new URIMintError(`A measurement IRI needs ${key}`)
    }
    return this.mint('measurement', metric, [subject, tool, metric, platform, timestamp])
  }
}

export default URIMinter
