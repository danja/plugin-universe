import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'
import URIMinter from '../rdf/URIMinter.js'
import { vendorKey, vendorSlug } from '../search/documents.js'

/**
 * Vendors, as resources rather than as strings.
 *
 * `trn:vendor "danja"` is what a source said, and it stays exactly as it is.
 * What it cannot do is be pointed at: a string has no description, no logo, no
 * support address and no owning account, two spellings of one maker are two
 * vendors for ever, and a rename orphans whatever was attached to the old
 * spelling because the key was computed from the name.
 *
 * This mints the identity that fixes all four, and asserts it beside the
 * string.
 *
 * **Derived, not harvested.** A harvester sees one source's graph; the identity
 * of a vendor is a fold *across* sources, because the same maker appears in
 * several. No harvester is in a position to compute it, which is why this runs
 * after ingest over the whole catalogue rather than inside each harvester —
 * doing it at harvest time would mint one vendor resource per source per name
 * and defeat the purpose.
 *
 * **The IRI is a content hash over the folded name**, so re-deriving is
 * idempotent: the same catalogue produces the same IRIs, and rebuilding the
 * graph changes nothing that points into it.
 *
 * **The fold is a grouping, not a judgement.** It merges "SFZ Tools" with
 * "SFZTools" because the characters say so. It does not merge "danja" with
 * "Danny Ayers", because nothing derivable from those strings ever will — that
 * is a human assertion, and the point of minting an IRI is that there is now
 * something for a human to assert it *about*.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const foaf = NAMESPACES.foaf
const skos = NAMESPACES.skos

/**
 * Group the catalogue's vendor strings into records.
 *
 * @param {Iterable<{iri: string, vendor: string|null, homepage: string|null}>} documents
 * @returns {object[]} one record per vendor, most plugins first
 */
export function vendorRecords (documents, minter = new URIMinter()) {
  const byKey = new Map()
  for (const doc of documents) {
    if (!doc.vendor) continue
    const key = vendorKey(doc.vendor)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), plugins: [] })
    const record = byKey.get(key)
    record.names.set(doc.vendor, (record.names.get(doc.vendor) ?? 0) + 1)
    record.plugins.push(doc.iri)
  }

  return [...byKey.values()].map(record => {
    // The spelling most of their plugins use. Ties go to the longer one, which
    // is how "SFZ Tools" wins over "SFZTools" — the separators are information,
    // and the form with them is the one somebody wrote deliberately. The same
    // rule `SearchService` groups by, because two rules would be two answers.
    const spellings = [...record.names.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .map(([name]) => name)
    const name = spellings[0]
    return {
      // Minted from the *key* on both halves — the readable part and the hash.
      //
      // `mint()` builds the IRI as `<slug of label>-<hash of identity>`, so
      // passing the display name as the label reintroduces exactly the defect
      // this feature exists to fix: "SFZTools" and "SFZ Tools" hash the same and
      // slug differently, and the identifier moves when somebody respells the
      // name. Readability is worth something and stability is worth more — and
      // the readable address already exists at `/vendor/<slug>`, which is where
      // a person goes.
      iri: minter.mint('vendor', record.key, [record.key]),
      key: record.key,
      name,
      spellings,
      slug: vendorSlug(name),
      plugins: record.plugins,
      count: record.plugins.length
    }
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * The triples one vendor record becomes.
 *
 * `foaf:maker` rather than a bespoke predicate: two widely-used vocabularies
 * already have a word for "the agent that made this", and `trn:vendor` keeps
 * holding the string exactly as harvested.
 */
export function vendorTriples (record) {
  const s = iri(record.iri)
  const triples = [
    `${s} ${iri(rdf + 'type')} ${iri(pu + 'Vendor')} .`,
    `${s} ${iri(foaf + 'name')} ${literal(record.name)} .`,
    `${s} ${iri(pu + 'vendorKey')} ${literal(record.key)} .`
  ]
  // Every other spelling met, so that merging two vendors later is adding one
  // of these rather than rewriting what a source said.
  for (const spelling of record.spellings.slice(1)) {
    triples.push(`${s} ${iri(skos + 'altLabel')} ${literal(spelling)} .`)
  }
  for (const plugin of record.plugins) {
    triples.push(`${iri(plugin)} ${iri(foaf + 'maker')} ${s} .`)
  }
  return triples
}

/** Every triple of the identity layer, for one catalogue. */
export function identityTriples (records) {
  return records.flatMap(vendorTriples)
}

/**
 * The names to show for one vendor: the minted identity's, where there is one.
 *
 * **Why this is not just the fold.** `SearchService` groups the loaded documents
 * by key and can re-derive the spellings it can see, which is what the vendor
 * page used to show. Two spellings it can never see that way: one carried by a
 * plugin in a graph the search does not load, and — the one that matters — one a
 * *person* asserted. "danja" and "Danny Ayers" are one maker and no fold over
 * the strings will ever say so; the way that gets recorded is a `skos:altLabel`
 * on the minted resource. A page that re-derives its own spellings would ignore
 * it, which would make the identity layer decorative.
 *
 * So the graph is the authority for the name, and the spellings are a **union**:
 * the identity's labels plus anything the corpus is currently using. The union
 * rather than a replacement because the two go stale in opposite directions — a
 * plugin accepted since the last `bin/mint-vendors.js` has a spelling the
 * identity has not met yet, and dropping it would make a page go *backwards*
 * when the identity layer arrived.
 *
 * `stale` names the second case so it can be counted rather than discovered. It
 * is not an error: it is the ordinary state between an accepted submission and
 * the next derivation.
 *
 * @param {{name: string, spellings: string[]}} folded - from the document fold
 * @param {{name: string, altLabels: string[]}|null} identity - from the graph
 */
export function vendorNames (folded, identity = null) {
  const foldSpellings = folded.spellings ?? []
  if (!identity) {
    return {
      name: folded.name,
      spellings: [...new Set(foldSpellings)],
      altLabels: [],
      minted: false,
      stale: []
    }
  }
  // The identity's own name leads, because that is the one the catalogue will
  // answer to and the one a vendor would be claiming.
  const asserted = [identity.name, ...identity.altLabels]
  const spellings = [...new Set([...asserted, ...foldSpellings])]
  const assertedSet = new Set(asserted)
  return {
    name: identity.name,
    spellings,
    altLabels: identity.altLabels,
    minted: true,
    // In the corpus, not in the identity: the layer needs re-deriving.
    stale: foldSpellings.filter(spelling => !assertedSet.has(spelling))
  }
}

export default vendorRecords
