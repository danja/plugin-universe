import fs from 'fs'
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
const owl = NAMESPACES.owl

/** Where the curated merges live, for everything that needs to agree about it. */
export const MERGE_FILE = 'data/curation/vendor-merges.json'

/**
 * Read the curated merge list.
 *
 * Here rather than in `bin/mint-vendors.js` because the script is not the only
 * thing that needs it: a test that re-derives the catalogue to check the stored
 * IRIs must apply the same merges, or it compares the store against a
 * derivation nobody performed and fails for a reason that is not a defect. That
 * is this project's most expensive recurring shape — two places that must agree
 * with nothing connecting them — so there is one reader and one path.
 *
 * A missing file is not an error: a catalogue with nobody to merge is the
 * ordinary case. A file that exists and does not parse throws, because that is
 * a person's edit and it holds a decision nothing else in the system does.
 */
export async function loadMerges (file = MERGE_FILE) {
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`)
  }
  if (parsed.merges !== undefined && !Array.isArray(parsed.merges)) {
    throw new Error(`${file}: "merges" must be a list.`)
  }
  return parsed.merges ?? []
}

/**
 * Check a curated merge list against the keys the catalogue actually has.
 *
 * **Why this refuses rather than warns.** A merge naming a key that does not
 * exist is a no-op that looks exactly like success: the derivation reports "376
 * vendors" whether the merge applied or not, so a typo in a hand-edited file
 * would be indistinguishable from a merge that worked. The GitHub candidate
 * file has the same property and `bin/ingest.js` exits on it.
 *
 * @param {{into: string, keys: string[], name?: string}[]} merges
 * @param {Set<string>} present - the vendor keys the catalogue holds
 * @param {Map<string, Set<string>>} [spellings] - key to the names met for it,
 *   so a `name` override can be checked against what sources actually wrote
 * @returns {string[]} what is wrong; empty means the list is applicable
 */
export function validateMerges (merges, present, spellings = null) {
  const problems = []
  const retired = new Map()
  const survivors = new Set()
  for (const merge of merges) {
    const into = merge?.into
    const keys = merge?.keys ?? []
    if (!into) { problems.push('a merge with no "into" key'); continue }
    if (!present.has(into)) {
      problems.push(`"${into}" is named as a survivor and is not a vendor key in the catalogue`)
    }
    survivors.add(into)
    if (keys.length === 0) problems.push(`"${into}" merges nothing into itself`)
    for (const key of keys) {
      if (key === into) { problems.push(`"${key}" is merged into itself`); continue }
      if (!present.has(key)) {
        problems.push(`"${key}" is merged into "${into}" and is not a vendor key in the catalogue`)
      }
      // Two survivors claiming one retired key is a file that cannot be applied
      // in a defined order, so it is refused rather than resolved by position.
      if (retired.has(key)) {
        problems.push(`"${key}" is merged into both "${retired.get(key)}" and "${into}"`)
      }
      retired.set(key, into)
    }
    // A display name has to be a name somebody actually used. Inventing one
    // here would put a string on the vendor page that appears in no source and
    // cannot be traced to one, which is the opposite of what the catalogue is.
    if (merge.name && spellings) {
      const met = new Set([into, ...keys].flatMap(key => [...(spellings.get(key) ?? [])]))
      if (!met.has(merge.name)) {
        problems.push(
          `"${merge.name}" is set as the display name for "${into}" and no source spells it that ` +
          `way. Met: ${[...met].join(', ') || 'nothing'}`)
      }
    }
  }
  // A key that is retired and also a survivor would make the result depend on
  // which merge ran first — a chain the file does not promise to express.
  for (const [key, into] of retired) {
    if (survivors.has(key)) problems.push(`"${key}" is both merged away and merged into (by "${into}")`)
  }
  return problems
}

/**
 * Group the catalogue's vendor strings into records.
 *
 * `merges` is the curated list of vendors that are one maker under two names —
 * a judgement, never a derivation. The fold groups spellings the *characters*
 * agree about; this is how a human says "danja" and "Danny Ayers" are the same
 * person, which nothing in the strings will ever imply.
 *
 * A merged-away key does not simply vanish. Its IRI has been published,
 * dereferences, and is in the CC0 dump, so the surviving record carries it in
 * `retired` and `vendorTriples` emits an `owl:sameAs` for it. An identifier this
 * project minted and distributed must keep answering.
 *
 * @param {Iterable<{iri: string, vendor: string|null, homepage: string|null}>} documents
 * @param {URIMinter} minter
 * @param {{into: string, keys: string[]}[]} merges
 * @returns {object[]} one record per vendor, most plugins first
 */
export function vendorRecords (documents, minter = new URIMinter(), merges = []) {
  // Retired key to surviving key. Built before the fold so a document's key is
  // mapped on the way in and there is only ever one group per maker.
  const canonical = new Map()
  for (const merge of merges) {
    for (const key of merge?.keys ?? []) {
      if (key !== merge.into) canonical.set(key, merge.into)
    }
  }
  const mintFor = key => minter.mint('vendor', key, [key])

  const byKey = new Map()
  for (const doc of documents) {
    if (!doc.vendor) continue
    const spelt = vendorKey(doc.vendor)
    if (!spelt) continue
    const key = canonical.get(spelt) ?? spelt
    if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), plugins: [], retired: new Set() })
    const record = byKey.get(key)
    // The spelling the source used is kept under the surviving key, so a merge
    // turns the retired name into one of the survivor's altLabels rather than
    // discarding it.
    record.names.set(doc.vendor, (record.names.get(doc.vendor) ?? 0) + 1)
    record.plugins.push(doc.iri)
    if (key !== spelt) record.retired.add(spelt)
  }

  // A merge may also say which spelling to show. The count picks well for a
  // fold — it is the spelling most sources use — and badly for a merge: "danja"
  // is on more plugins than "Danny Ayers" and a vendor buying a profile may want
  // their own name on it. It must still be a spelling the catalogue actually
  // met, so this chooses between observed names and never invents one.
  const display = new Map()
  for (const merge of merges) {
    if (merge?.name) display.set(merge.into, merge.name)
  }

  return [...byKey.values()].map(record => {
    // The spelling most of their plugins use. Ties go to the longer one, which
    // is how "SFZ Tools" wins over "SFZTools" — the separators are information,
    // and the form with them is the one somebody wrote deliberately. The same
    // rule `SearchService` groups by, because two rules would be two answers.
    const counted = [...record.names.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .map(([name]) => name)
    const chosen = display.get(record.key)
    // An override that names a spelling nobody used is ignored rather than
    // obeyed: `validateMerges` refuses it up front, and this keeps the
    // derivation total if one reaches here by another path.
    const name = chosen && counted.includes(chosen) ? chosen : counted[0]
    // The chosen name leads; every other spelling follows it as an altLabel.
    const spellings = [name, ...counted.filter(spelling => spelling !== name)]
    return {
      // Keys merged into this one. Their IRIs were published and must keep
      // answering, so they travel with the record rather than being dropped.
      retired: [...record.retired].sort().map(key => ({ key, iri: mintFor(key) })),
      // Minted from the *key* on both halves — the readable part and the hash.
      //
      // `mint()` builds the IRI as `<slug of label>-<hash of identity>`, so
      // passing the display name as the label reintroduces exactly the defect
      // this feature exists to fix: "SFZTools" and "SFZ Tools" hash the same and
      // slug differently, and the identifier moves when somebody respells the
      // name. Readability is worth something and stability is worth more — and
      // the readable address already exists at `/vendor/<slug>`, which is where
      // a person goes.
      iri: mintFor(record.key),
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
  // A merged-away vendor's IRI, pointing at the one that survived.
  //
  // Deliberately *not* typed `pu:Vendor`. The retired resource has been
  // published, dereferences, and sits in the CC0 dump, so it has to keep
  // answering — but typing it would make it load as a second identity and
  // un-merge the very fold the merge performed. `owl:sameAs` is already this
  // project's idiom for "this is the same thing under another name"; plugins
  // preserve their upstream IRIs the same way.
  for (const { iri: retiredIri } of record.retired ?? []) {
    triples.push(`${iri(retiredIri)} ${iri(owl + 'sameAs')} ${s} .`)
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
