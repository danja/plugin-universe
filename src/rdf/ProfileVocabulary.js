import { parseTurtleFile } from '../harvest/TurtleReader.js'
import { PLATFORMS } from '../harvest/Platforms.js'
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
const pu = NAMESPACES.pu
const PLATFORM_FILE = 'vocabs/plugin-universe.ttl'

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

/**
 * The platforms a profile may name, read from `vocabs/plugin-universe.ttl`.
 *
 * A separate function because they are in a separate namespace and a separate
 * file — `pu:Windows` is not a `trn:` term and never will be — but the same
 * rule and for the same reason: the form must not offer what the shapes will
 * refuse, and a list of platforms written out in JavaScript is a copy of an
 * ontology.
 *
 * `rdfs:label` matters here more than anywhere else in this file. The local
 * name is `MacOS`, because a Turtle local name has to be one, and the label is
 * "macOS", because that is how Apple spells it and how a reader will look for
 * it. Deriving the label from the local name would put "MacOS" on every plugin
 * page and in every checkbox — the exact defect `trn:ControlMidi` had.
 *
 * @returns {Promise<{platforms: object[]}>} shaped like the profile
 *   vocabularies, so `withProfileVocabulary` consumes it unchanged.
 */
export async function loadPlatformVocabulary (file = PLATFORM_FILE) {
  const dataset = await parseTurtleFile(file)

  const labels = new Map()
  const comments = new Map()
  const platformIris = new Set()

  for (const quad of dataset) {
    const predicate = quad.predicate.value
    if (predicate === `${rdfs}label`) labels.set(quad.subject.value, quad.object.value)
    else if (predicate === `${rdfs}comment`) comments.set(quad.subject.value, quad.object.value)
    // Typed directly as pu:Platform, the way pu:Free is typed pu:Pricing. The
    // class itself carries rdfs:label too and is not one of its own members, so
    // matching on the type rather than on the label is what keeps "Platform"
    // out of the list of platforms.
    else if (predicate === `${rdf}type` && quad.object.value === `${pu}Platform`) {
      platformIris.add(quad.subject.value)
    }
  }

  if (platformIris.size === 0) {
    throw new Error(`${file} defines no pu:Platform individuals, so no platform can be offered.`)
  }

  // Ordered by `PLATFORMS` rather than alphabetically or by the order the
  // parser happened to yield, so the form's checkboxes, the plugin page's row
  // and the JSON-LD all read the same way round. Written as a filter rather
  // than a comparator on purpose: `indexOf` returns -1 for something not on the
  // list and a comparator would silently sort it to the front, which is the
  // `slice(-1)` trap in CLAUDE.md wearing different clothes. A platform in the
  // file and not in `PLATFORMS` is dropped here and fails the binding test,
  // which is the pair of outcomes worth having.
  return {
    platforms: PLATFORMS
      .filter(subject => platformIris.has(subject))
      .map(subject => ({
        iri: subject,
        value: subject.replace(pu, ''),
        label: labels.get(subject) ?? subject.replace(pu, ''),
        help: comments.get(subject) ?? null
      }))
  }
}

export default loadProfileVocabulary
