import { iri, literal } from '../store/SPARQLHelper.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * How each facet narrows the set: facet name to the graph pattern it adds.
 *
 * One table rather than a chain of `if`s, so that a facet the API accepts and
 * the filter ignores is a missing key rather than a missing line — the shape of
 * defect this project keeps shipping, and the exact one `/plugins` had when it
 * read `?category=` off the request and filtered nothing.
 * `tests/search/facet-coverage.test.js` asserts these keys are `FACET_NAMES`.
 *
 * Most are properties of the plugin **in the graph the plugin came from**;
 * `?g` is bound by `plugin/filter.sparql`, so reusing it is what stops a facet
 * matching across two sources by accident. Values are local names rather than
 * IRIs throughout, so that a URL reads as a question: `?pricing=Free`, not a
 * percent-encoded `http://…`. A local name the vocabulary does not define mints
 * an IRI nothing carries and matches nothing, which is the right answer to a
 * typed-in URL.
 */
const own = pattern => `GRAPH ?g { ${pattern} }`
const FACET_PATTERNS = Object.freeze({
  format: value => own(`?plugin ${iri(NAMESPACES.trn + 'format')} ${iri(NAMESPACES.trn + value)}`),
  role: value => own(`?plugin ${iri(NAMESPACES.trn + 'role')} ${iri(NAMESPACES.trn + value)}`),
  // The two halves of a signal chain. `?accepts=Midi` is "what can follow
  // something that produces MIDI", which is the question the catalogue holds
  // the answer to and, until these existed, never offered.
  accepts: value => own(`?plugin ${iri(NAMESPACES.trn + 'accepts')} ${iri(NAMESPACES.trn + value)}`),
  produces: value => own(`?plugin ${iri(NAMESPACES.trn + 'produces')} ${iri(NAMESPACES.trn + value)}`),
  category: value =>
    own(`?plugin ${iri(NAMESPACES.pu + 'category')} ${iri(`${NAMESPACES.pu}category/${value}`)}`),
  vendor: value => own(`?plugin ${iri(NAMESPACES.trn + 'vendor')} ${literal(value)}`),
  // The availability facets: the two questions asked most often about a plugin,
  // worth facets of their own rather than being buried in the licence string.
  source: value =>
    own(`?plugin ${iri(NAMESPACES.pu + 'sourceAvailability')} ${iri(NAMESPACES.pu + value)}`),
  pricing: value => own(`?plugin ${iri(NAMESPACES.pu + 'pricing')} ${iri(NAMESPACES.pu + value)}`),
  licence: value => own(`?plugin ${iri(NAMESPACES.pu + 'licenceId')} ${literal(value)}`),
  // The one that is not a property of the plugin. A verdict lives in the
  // profiler's own run graph, so this joins rather than filters: a plugin
  // measured twice matches if any run says so. Which reading a page *shows* is
  // a different question, and that one is the newest.
  measured: value =>
    `GRAPH ?measurements { ?measurement ${iri(NAMESPACES.pu + 'subject')} ?plugin ; ` +
    `${iri(NAMESPACES.pu + 'metric')} ${iri(NAMESPACES.pu + 'ValidationResult')} ; ` +
    `${iri(NAMESPACES.pu + 'value')} ${literal(value)} }`
})

export { FACET_PATTERNS }
