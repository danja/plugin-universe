import { Readable } from 'stream'
import { rdfParser } from 'rdf-parse'
import rdf from 'rdf-ext'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { literal } from '../store/SPARQLHelper.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { SUBMITTABLE } from './Submissions.js'

/**
 * A plugin profile as a file: written out, and read back in.
 *
 * The catalogue would rather authors **hosted their own profiles** than typed
 * them into this site. A `profile.ttl` beside a plugin's own download is a fact
 * its author controls, versioned with the plugin, readable by anything that
 * speaks RDF and by this catalogue among them. A form on somebody else's
 * website is none of those things — it is a copy of the truth, kept somewhere
 * the author cannot edit, going stale from the moment it is saved.
 *
 * So this does two things and they are deliberately inverses:
 *
 *  - **Write.** What is typed into `/submit` comes back as a profile the author
 *    can put next to their plugin. The form stops being the destination and
 *    becomes a way of producing the file.
 *  - **Read.** A profile pasted in — Turtle or JSON-LD — is parsed into the
 *    same fields the form holds, and **drafted into it for checking**. It is
 *    not a second way to write to the store: the ordinary Submit button is
 *    still what saves, through the same validator, the same shapes and the same
 *    serialiser. One write path, which is the rule that has kept `SUBMITTABLE`,
 *    `vocabs/shapes.ttl` and the serialiser from drifting apart.
 *
 * **Nothing here fetches anything.** A profile arrives as text somebody pasted,
 * so there is no URL, no request this server makes on a stranger's behalf and
 * none of the defences `PageReader` needs. The bound that matters here is size,
 * and it is applied before parsing.
 */

const trn = NAMESPACES.trn
const pu = NAMESPACES.pu
const rdfNs = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const foaf = NAMESPACES.foaf

export class ProfileError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ProfileError'
  }
}

/** Which `SUBMITTABLE` field each predicate fills, and how to read its object. */
const FROM_PREDICATE = Object.freeze({
  [`${rdfs}label`]: { field: 'name', as: 'text' },
  [`${rdfs}comment`]: { field: 'description', as: 'text' },
  [`${trn}vendor`]: { field: 'vendor', as: 'text' },
  [`${foaf}homepage`]: { field: 'homepage', as: 'iri' },
  [`${trn}format`]: { field: 'format', as: 'localName' },
  [`${trn}role`]: { field: 'role', as: 'localName' },
  [`${trn}accepts`]: { field: 'accepts', as: 'localName' },
  [`${trn}produces`]: { field: 'produces', as: 'localName' },
  [`${trn}requires`]: { field: 'requires', as: 'localName' },
  [`${trn}caution`]: { field: 'caution', as: 'text' },
  [`${pu}category`]: { field: 'category', as: 'localName' },
  [`${pu}licenceId`]: { field: 'licenceId', as: 'text' }
})

/**
 * The profile a set of typed fields becomes.
 *
 * Prefixed names and a readable layout, because this is a file a person will
 * open, edit and commit — not a serialisation for a machine. It is the shape
 * the fifty downspout profiles already use, which is the shape this catalogue
 * reads without translation.
 *
 * **The subject is the plugin's homepage.** A profile needs a subject IRI and
 * the author has to be able to choose it; the homepage is the one IRI they
 * certainly control, it is already required by the form, and it is what this
 * catalogue mints identity from — so a profile written here and harvested later
 * describes the same thing rather than a second copy of it. An author who
 * prefers their own namespace only has to change one line, and the file says so.
 *
 * Literals go through `literal()` — the same escaping the store writes with —
 * so a description containing a quote or a newline produces a valid file rather
 * than a broken one.
 */
export function profileTurtle (fields = {}, { subject = null } = {}) {
  const homepage = String(fields.homepage ?? '').trim()
  // A subject may be given instead. The catalogue offers a profile for every
  // plugin it holds, and three of the 645 have no homepage — for those the
  // plugin's own minted IRI is the subject, which dereferences through the PURL
  // and so is a better answer than refusing to produce a file at all.
  const about = subject ?? homepage
  if (!about) {
    throw new ProfileError(
      'A profile needs the homepage: it is the subject of the file and what identifies the plugin.')
  }
  const name = String(fields.name ?? '').trim()
  if (!name) throw new ProfileError('A profile needs the plugin\'s name.')

  const list = value => (Array.isArray(value) ? value : [value])
    .map(one => String(one ?? '').trim()).filter(Boolean)

  const lines = []
  const say = (predicate, object) => lines.push(`    ${predicate} ${object}`)

  say('a', 'trn:PluginProfile')
  say('rdfs:label', literal(name))
  for (const value of list(fields.description)) say('rdfs:comment', literal(value))
  for (const value of list(fields.vendor)) say('trn:vendor', literal(value))
  // Always stated, even when it is also the subject: a consumer that has been
  // handed the file on its own, with no idea where it came from, still learns
  // the plugin's address from it.
  if (homepage) say('foaf:homepage', `<${homepage}>`)

  // The vocabulary terms, in the order the form asks for them so that a person
  // comparing the two can follow.
  const terms = (field, prefix) => {
    const values = list(fields[field])
    if (values.length > 0) say(prefix, values.map(v => `trn:${v}`).join(', '))
  }
  terms('format', 'trn:format')
  terms('role', 'trn:role')
  terms('accepts', 'trn:accepts')
  terms('produces', 'trn:produces')
  terms('requires', 'trn:requires')

  // A full IRI, not `pu:category/reverb`. A slash is not legal in the local
  // part of a prefixed name, so that spelling produces a file that does not
  // parse — found by reading a generated profile straight back in, which is the
  // only check that would have caught it.
  for (const value of list(fields.category)) say('pu:category', `<${pu}category/${value}>`)
  for (const value of list(fields.licenceId)) say('pu:licenceId', literal(value))
  for (const value of list(fields.caution)) say('trn:caution', literal(value))

  return `# A plugin profile — machine-readable facts about ${name}.
#
# Host this next to your plugin as profile.ttl and it can be read by this
# catalogue and by anything else that speaks RDF. It is yours: edit it, version
# it with the plugin, and it stays correct because you control it.
#
# The subject below is the plugin's homepage, which is what identifies it here.
# If you would rather use your own namespace, change that one IRI and keep the
# foaf:homepage line, so the two can still be joined up.
#
# Terms: https://plugin-universe.com/ns   Guide: https://plugin-universe.com/about/profiles

@prefix trn:  <${trn}> .
@prefix pu:   <${pu}> .
@prefix rdfs: <${rdfs}> .
@prefix foaf: <${foaf}> .

<${about}>
${lines.join(' ;\n')} .
`
}

/** The local name of an IRI — `trn:AudioEffect` from the full term. */
function localName (value) {
  return String(value).replace(/^.*[/#]/, '')
}

/**
 * A plugin the catalogue holds, as the fields a profile is written from.
 *
 * So that every plugin page can offer the same file `/submit` produces. An
 * author who finds their plugin already catalogued should not have to fill in a
 * form to get a profile they could have had: the facts are here, they are CC0,
 * and handing them back as a file the author can host is the whole argument of
 * `/about/profiles` carried through to the one page where it matters most.
 *
 * The document's field names differ from the form's — `formats` against
 * `format`, `cautions` against `caution`, `image` against `depiction` — because
 * one is what a query returned and the other is what a person filled in. This
 * is the one place that mapping lives.
 */
export function profileFieldsFor (doc = {}) {
  return {
    name: doc.name ?? '',
    homepage: doc.homepage ?? '',
    vendor: doc.vendor ?? '',
    description: doc.description ?? '',
    format: doc.formats ?? [],
    role: doc.roles ?? [],
    accepts: doc.accepts ?? [],
    produces: doc.produces ?? [],
    requires: doc.requires ?? [],
    // One category, because `SUBMITTABLE` holds one and the shapes allow one.
    // A harvested plugin may carry several; the first is the one the page leads
    // with, and an author editing the file can say otherwise.
    category: (doc.categories ?? [])[0] ?? '',
    licenceId: doc.licenceId ?? '',
    caution: doc.cautions ?? ''
  }
}

/**
 * Read a profile document into the fields the submission form holds.
 *
 * Turtle or JSON-LD, told apart by looking rather than by asking: a document
 * beginning `{` or `[` is JSON. Making somebody choose the format of a file
 * they were told to paste is a question with an answer already in the box.
 *
 * @returns {{fields: object, sources: object, notes: string[], format: string}}
 *   shaped as `PageReader.read` returns, so the draft renders the same way.
 */
export async function readProfile (text, { submittable = SUBMITTABLE } = {}) {
  const body = String(text ?? '').trim()
  if (!body) throw new ProfileError('Paste a profile first.')
  if (body.length > CONTRIBUTION_CONFIG.maxProfileLength) {
    throw new ProfileError(
      `That profile is longer than ${CONTRIBUTION_CONFIG.maxProfileLength} characters. ` +
      'Send the URL of the file instead, through the feedback form.')
  }

  const looksJson = body.startsWith('{') || body.startsWith('[')
  const contentType = looksJson ? 'application/ld+json' : 'text/turtle'
  const format = looksJson ? 'JSON-LD' : 'Turtle'

  let dataset
  try {
    const quads = []
    await new Promise((resolve, reject) => {
      rdfParser.parse(Readable.from([body]), {
        contentType,
        // Relative IRIs in a pasted file have nothing to resolve against. This
        // gives them something rather than failing, and the values that matter
        // — a homepage — are absolute in any profile worth submitting.
        baseIRI: `${pu}profile/pasted`
      })
        .on('data', quad => quads.push(quad))
        .on('error', reject)
        .on('end', resolve)
    })
    dataset = rdf.dataset(quads)
  } catch (error) {
    throw new ProfileError(
      `That does not parse as ${format}: ${error.message.split('\n')[0]}`)
  }
  if (dataset.size === 0) {
    throw new ProfileError(`No statements found. Is that a complete ${format} document?`)
  }

  const subject = chooseSubject(dataset)
  if (!subject) {
    throw new ProfileError(
      'No plugin found in that profile. One subject should be a trn:PluginProfile, ' +
      'or at least carry an rdfs:label.')
  }

  const fields = {}
  const sources = {}
  const notes = []
  for (const quad of dataset) {
    if (quad.subject.value !== subject) continue
    const mapping = FROM_PREDICATE[quad.predicate.value]
    if (!mapping) continue
    const spec = submittable[mapping.field]
    if (!spec) continue
    const value = mapping.as === 'localName' ? localName(quad.object.value) : quad.object.value
    if (!value) continue
    if (spec.multiple) {
      fields[mapping.field] = [...new Set([...(fields[mapping.field] ?? []), value])]
    } else if (fields[mapping.field] === undefined) {
      fields[mapping.field] = value
    }
    sources[mapping.field] = `the profile's ${shortPredicate(quad.predicate.value)}`
  }

  // Said rather than silently dropped. A profile commonly carries more than
  // this form holds — ports, parameters, routing — and somebody who wrote those
  // deserves to know they were read and not kept, rather than assuming.
  const unread = new Set()
  for (const quad of dataset) {
    if (quad.subject.value !== subject) continue
    if (quad.predicate.value === `${rdfNs}type`) continue
    if (!FROM_PREDICATE[quad.predicate.value]) unread.add(shortPredicate(quad.predicate.value))
  }
  if (unread.size > 0) {
    notes.push(
      `This form does not hold ${[...unread].sort().join(', ')}, so ` +
      `${unread.size === 1 ? 'it was' : 'they were'} not drafted. Ports and parameters are ` +
      'read from a bundle by a moderator — see /about/profiles.')
  }
  for (const [key, spec] of Object.entries(submittable)) {
    if (spec.required && fields[key] === undefined) {
      notes.push(`${spec.label} is not in the profile and is needed — fill it in below.`)
    }
  }

  return { fields, sources, notes, format, subject }
}

/**
 * Which subject the profile is about.
 *
 * A `trn:PluginProfile` if one says so. Failing that, the one subject carrying
 * an `rdfs:label` — the same forgiveness `typeAsPlugins` extends to an LV2
 * bundle whose real description types the plugin by subclass and never as the
 * bare class. A file that is right in substance and loose about typing should
 * be read, not refused.
 *
 * Ambiguity is refused rather than guessed: two labelled subjects and no type
 * means picking one, and picking the wrong one produces a submission about the
 * wrong plugin.
 */
function chooseSubject (dataset) {
  const typed = []
  const labelled = new Set()
  for (const quad of dataset) {
    if (quad.predicate.value === `${rdfNs}type` && quad.object.value === `${trn}PluginProfile`) {
      typed.push(quad.subject.value)
    }
    if (quad.predicate.value === `${rdfs}label`) labelled.add(quad.subject.value)
  }
  if (typed.length === 1) return typed[0]
  if (typed.length > 1) {
    throw new ProfileError(
      `That profile describes ${typed.length} plugins. Submit one at a time.`)
  }
  if (labelled.size === 1) return [...labelled][0]
  if (labelled.size > 1) {
    throw new ProfileError(
      `That profile has ${labelled.size} labelled subjects and none typed trn:PluginProfile, ` +
      'so there is no way to tell which is the plugin. Add "a trn:PluginProfile" to it.')
  }
  return null
}

/** `trn:accepts` from the full predicate IRI, for a message a person reads. */
function shortPredicate (value) {
  for (const [prefix, namespace] of Object.entries({ trn, pu, rdfs, foaf })) {
    if (value.startsWith(namespace)) return `${prefix}:${value.slice(namespace.length)}`
  }
  return value
}

export default readProfile
