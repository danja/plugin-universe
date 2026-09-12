import { parseTurtleFile } from '../harvest/TurtleReader.js'
import { NAMESPACES } from './NamespaceManager.js'

/**
 * What a plugin profile may say about behaviour, read from the vocabulary.
 *
 * Roles, signal types and host requirements are all closed lists, and the
 * submission form has to offer them. The alternative is a copy in JavaScript —
 * and a copy of a vocabulary is the mistake this project has already made once
 * and written down: the category scheme lived as an object literal of parent
 * links, which is why it had four predicates and no way to say what a category
 * meant. `CategoryScheme` reads `categories.ttl` for the same reason this reads
 * `trn-profile.ttl`.
 *
 * **The form therefore cannot offer a term the vocabulary does not define**,
 * which is not a convenience: `vocabs/shapes.ttl` constrains what may be
 * written, so a form offering anything else would be a form whose submissions
 * fail validation after somebody has filled it in.
 *
 * Labels come from the file too. `rdfs:label` on `trn:ControlMidi` is
 * "Control MIDI", and deriving that from the local name would produce
 * "ControlMidi" — which is the sort of thing nobody notices until it is on a
 * page in front of a vendor.
 */

const trn = NAMESPACES.trn
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const owl = NAMESPACES.owl

const FILE = 'vocabs/trn-profile.ttl'

/**
 * Read the profile vocabulary.
 *
 * One pass over the dataset rather than repeated `match()` calls — the same
 * shape `CategoryScheme` uses, and it avoids needing to construct RDF terms to
 * query with.
 *
 * @returns {Promise<{roles: object[], signals: object[], requirements: object[]}>}
 */
export async function loadProfileVocabulary (file = FILE) {
  const dataset = await parseTurtleFile(file)

  const labels = new Map()
  const comments = new Map()
  const roleIris = new Set()
  const individualIris = new Set()

  for (const quad of dataset) {
    const predicate = quad.predicate.value
    if (predicate === `${rdfs}label`) labels.set(quad.subject.value, quad.object.value)
    else if (predicate === `${rdfs}comment`) comments.set(quad.subject.value, quad.object.value)
    // Roles are read from the class hierarchy rather than listed, so a role
    // added to the vocabulary appears in the form with no code change — which
    // is the whole point of letting the ontology lead.
    else if (predicate === `${rdfs}subClassOf` && quad.object.value === `${trn}PluginRole`) {
      roleIris.add(quad.subject.value)
    } else if (predicate === `${rdf}type` && quad.object.value === `${owl}NamedIndividual`) {
      individualIris.add(quad.subject.value)
    }
  }

  const term = subject => ({
    iri: subject,
    // The bare local name is what a submitted value carries and what
    // `valueTerm` turns back into an IRI, so the round trip is `Audio` →
    // `trn:Audio` → `Audio` and never touches a label.
    value: subject.replace(trn, ''),
    // From the file. Deriving it from the local name would render
    // `trn:ControlMidi` as "ControlMidi" rather than "Control MIDI" — the sort
    // of thing nobody notices until it is on a page in front of a vendor.
    label: labels.get(subject) ?? subject.replace(trn, ''),
    help: comments.get(subject) ?? null
  })

  // Signal types and host requirements are both owl:NamedIndividual, which on
  // its own cannot tell them apart. They are separated by what refers to them:
  // these two are the range of trn:requires and everything else in this file is
  // a signal. Fragile if a third kind of individual is added, which is why the
  // test asserts the counts rather than trusting the split.
  const REQUIREMENTS = new Set([`${trn}HostTransport`, `${trn}Launchpad`])
  const byLabel = (a, b) => a.label.localeCompare(b.label)

  return {
    roles: [...roleIris].map(term).sort(byLabel),
    signals: [...individualIris].filter(one => !REQUIREMENTS.has(one)).map(term).sort(byLabel),
    requirements: [...individualIris].filter(one => REQUIREMENTS.has(one)).map(term).sort(byLabel)
  }
}

export default loadProfileVocabulary
