import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import { loadProfileVocabulary } from '../../src/rdf/ProfileVocabulary.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The vocabulary and the catalogue, checked against each other.
 *
 * `vocabs/trn-profile.ttl` is what the submission form offers and what supplies
 * the labels; the catalogue is what the harvesters actually wrote. Nothing
 * compared them, and they had drifted: `trn:AudioSidechain` and `trn:MidiCC`
 * were on plugins in the store and defined nowhere, so a vendor could not
 * declare a sidechain input through the form and the value had no label to
 * render — which only became visible when signal types first reached a page.
 *
 * The shapes cannot catch this. They constrain these predicates to the `trn:`
 * namespace rather than enumerating the individuals, deliberately: refusing an
 * unrecognised term at ingest would discard a fact that is probably true and
 * merely undescribed. So the check belongs here, where it reports rather than
 * refuses.
 *
 * The direction matters. This asserts **data ⊆ vocabulary** and not the
 * reverse: a defined term nothing uses yet is a term waiting for its first
 * plugin, which is fine. A used term nothing defines is a hole.
 */

describe('every signal type in the catalogue is defined in the vocabulary', () => {
  let used
  let vocabulary

  beforeAll(async () => {
    const config = await Config.load()
    const client = new SPARQLClient(config.get('storage.endpoint'))
    const predicates = ['accepts', 'produces', 'requires']
      .map(name => `<${NAMESPACES.trn}${name}>`).join(', ')
    // Asked of the store rather than of the loaded documents: a term on a
    // plugin in a graph the search does not load is still a term in the
    // catalogue, and still one the form should be able to offer.
    const rows = await client.select(
      `SELECT DISTINCT ?p ?o WHERE { GRAPH ?g { ?s ?p ?o . FILTER(?p IN (${predicates})) } }`)
    used = rows.map(row => ({
      predicate: row.p.replace(NAMESPACES.trn, ''),
      term: row.o.replace(NAMESPACES.trn, ''),
      iri: row.o
    }))
    vocabulary = await loadProfileVocabulary()
  })

  it('finds signal types to check at all', () => {
    // Without this the suite passes by vacuum — the failure mode of every test
    // whose subject is "nothing violates X". 181 plugins declare what they
    // accept and 189 what they produce, so an empty result means the query
    // broke, not that the catalogue is clean.
    expect(used.length).toBeGreaterThan(5)
  })

  it('defines each one, with a label', () => {
    const defined = new Map(
      [...vocabulary.signals, ...vocabulary.requirements].map(term => [term.value, term]))
    const missing = used
      .filter(one => one.iri.startsWith(NAMESPACES.trn))
      .filter(one => !defined.has(one.term))
      .map(one => `${one.predicate} -> ${one.term}`)
    expect(missing, 'used by a plugin and defined in no vocabulary file').toEqual([])

    // A label, not a local name falling back on itself — `ControlMidi` shown
    // as "ControlMidi" is the sort of thing nobody notices until it is on a
    // page in front of a vendor. Only checked where the local name is
    // camel-case: `trn:Audio` is labelled "Audio" and rightly so, so equality
    // on its own proves nothing. An interior capital does.
    for (const one of used.filter(one => one.iri.startsWith(NAMESPACES.trn))) {
      const term = defined.get(one.term)
      expect(term.label, `${one.term} has an empty label`).toBeTruthy()
      if (/[a-z][A-Z]/.test(one.term)) {
        expect(term.label, `${one.term} has no rdfs:label, so it renders as its local name`)
          .not.toBe(one.term)
      }
    }
  })

  /**
   * A requirement may come from somebody else's vocabulary. A signal may not.
   *
   * That asymmetry is `vocabs/shapes.ttl`'s decision, not this test's:
   * `trn:accepts` and `trn:produces` are constrained to the `trn:` namespace
   * because the catalogue's signal list is what makes chains suggestable and a
   * private signal type would only ever match itself; `trn:requires` carries a
   * host capability, and a capability defined elsewhere is still a capability —
   * JigDAW's `jig:MidiEvents` and `jig:MidiOut` are the case that opened it.
   *
   * The shape changed and this file did not, which is the failure at the top of
   * CLAUDE.md: three JigDAW plugins ingested cleanly, conformed to the shapes,
   * and failed here — reported as "defined in no vocabulary file", which is
   * true and is no longer the same thing as wrong. So the rule is written down
   * on both sides now.
   *
   * What an external term does *not* get is a label: the plugin page shows its
   * local name, by the policy in `render-plugin.js`. That is a gap worth
   * closing and not a reason to refuse the fact.
   */
  it('takes a host capability from another published vocabulary, and a signal from no one', () => {
    const external = used.filter(one => !one.iri.startsWith(NAMESPACES.trn))
    for (const one of external) {
      expect(one.predicate,
        `${one.iri} is used with trn:${one.predicate}, which vocabs/shapes.ttl ` +
        'constrains to the trn: namespace')
        .toBe('requires')
      expect(one.iri, `${one.iri} is not a dereferenceable IRI`).toMatch(/^https?:\/\//)
    }
  })

  it('keeps host requirements out of the signal list', () => {
    // The two kinds are both owl:NamedIndividual and are told apart by what
    // refers to them, which is fragile enough to be worth asserting: a
    // requirement offered as a signal would let somebody say their plugin
    // produces a host transport.
    const signals = vocabulary.signals.map(one => one.value)
    const requirements = vocabulary.requirements.map(one => one.value)
    expect(signals).not.toContain('HostTransport')
    expect(signals).not.toContain('Launchpad')
    expect(requirements.sort()).toEqual(['HostTransport', 'Launchpad'])

    // And the split has to match how the data uses them, which is the fact the
    // hand-maintained REQUIREMENTS set in ProfileVocabulary is guessing at.
    // Only the terms this vocabulary is answerable for. An external capability
    // is classified by the vocabulary that defines it, and the test above is
    // the one that holds it to anything.
    for (const one of used.filter(one => one.iri.startsWith(NAMESPACES.trn))) {
      const list = one.predicate === 'requires' ? requirements : signals
      expect(list, `${one.term} is used with trn:${one.predicate} but classed otherwise`)
        .toContain(one.term)
    }
  })
})
