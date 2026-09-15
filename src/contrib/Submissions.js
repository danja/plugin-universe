import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import ensureContributorGraphs from './ContributorGraphs.js'
import QueryService from '../store/QueryService.js'
import { STATUS } from './Corrections.js'
import { toKnownSpdx, SELECTABLE_LICENCES } from '../harvest/Licensing.js'
import { loadProfileVocabulary, loadPlatformVocabulary } from '../rdf/ProfileVocabulary.js'
import CategoryScheme from '../rdf/CategoryScheme.js'

/**
 * Submissions: a person proposing a plugin the catalogue does not have.
 *
 * Corrections were the narrowest possible first write by a stranger — one fact
 * about one plugin. This is the next one out, and it is deliberately shaped the
 * same way rather than as a general "write some RDF" form.
 *
 * **The homepage is the identity, and that is why it is required.** A harvester
 * identifies a plugin by its bundle name and class id, or by its own canonical
 * IRI; a person has neither. What a person does have is the address of the
 * project, and it is stable in the way a name is not — two plugins called
 * "Reverb" are common, two at the same URL are the same plugin. Minting from it
 * means a duplicate submission collides with the original instead of quietly
 * becoming a second record of one thing, which is the failure `IngestPipeline`
 * refuses for harvesters and which a form would otherwise reintroduce.
 *
 * **A submission is reviewed whole.** A correction can be accepted on its own
 * because the plugin already exists; a plugin needs a name to exist at all, so
 * half of one is a record nothing can display. The proposed fields therefore
 * live on the submission until it is accepted, and only then are they written
 * into the contributor's CC0 graph.
 *
 * **Nothing unreviewed reaches a public graph.** Until a moderator accepts —
 * or the contributor is trusted, which is the same promotion corrections use —
 * the proposal is a record in the queue and the catalogue does not have it.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const trn = NAMESPACES.trn
const foaf = NAMESPACES.foaf
const prov = NAMESPACES.prov

export class SubmissionError extends Error {
  constructor (message, { existing = null } = {}) {
    super(message)
    this.name = 'SubmissionError'
    // The plugin this submission turned out to duplicate, so the caller can
    // link to it rather than only saying no.
    this.existing = existing
  }
}

/**
 * What a person may state about a plugin they are proposing.
 *
 * Shorter than what a harvester writes, on purpose. Everything here is either
 * needed to identify the plugin, needed to display it, or a facet without which
 * it would be invisible to every filter on the site. Measurements, releases,
 * checksums and parameters are not on this list: those are things the catalogue
 * finds out, not things it is told.
 */
/**
 * The plugin formats a submission may claim.
 *
 * The same nine the SHACL shapes enumerate, and
 * `tests/contrib/Submissions.test.js` asserts the two agree. This is the shape
 * of coupling that has cost this project most — a list in code and the same
 * list in `vocabs/shapes.ttl`, with nothing connecting them, which is how a
 * GitHub sweep once produced 136 violations. A format missing here is one
 * nobody can submit; a format here that the shapes reject is a submission that
 * passes the form and fails at the last moment.
 */
export const PLUGIN_FORMATS = Object.freeze([
  'VST3', 'VST2', 'CLAP', 'AudioUnit', 'AudioUnitV3', 'LV2', 'LADSPA', 'AAX', 'Standalone'
])

export const SUBMITTABLE = Object.freeze({
  name: {
    predicate: `${rdfs}label`, label: 'Name', kind: 'text', required: true,
    help: 'The name as its author writes it.'
  },
  homepage: {
    predicate: `${foaf}homepage`, label: 'Homepage', kind: 'url', required: true,
    help: 'The project page. This is what identifies the plugin, so it has to be the real one.'
  },
  vendor: {
    predicate: `${trn}vendor`, label: 'Vendor', kind: 'text', required: true,
    help: 'Who makes it — a person or a company.'
  },
  description: {
    predicate: `${rdfs}comment`, label: 'Description', kind: 'text', required: false,
    help: 'What it does, in a sentence or two.'
  },
  format: {
    predicate: `${trn}format`, label: 'Formats', kind: 'format', required: true,
    // A plugin is commonly built for several, and the catalogue already models
    // it that way — trn:format has no maxCount in the shapes. A single-choice
    // field would have forced a contributor to pick one and lose the rest.
    multiple: true,
    // The options travel with the field rather than being passed to the form.
    // Passed separately they can be forgotten, and a required checkbox group
    // with no boxes is a form nobody can complete — which is worse than an
    // error, because it looks like it should work.
    choices: PLUGIN_FORMATS,
    help: 'Every format it is built for. At least one.'
  },
  category: {
    predicate: `${pu}category`, label: 'Category', kind: 'category', required: false,
    // Chosen from the scheme, not typed. It was a text box checked only against
    // `^[a-z0-9-]+$`, so "revrb" or "Reverb" or an invented category passed and
    // became `pu:category/revrb` — a concept with no definition, which
    // `tests/store/categories.test.js` then reports as undescribed, long after
    // the person who could have corrected it has gone.
    //
    // `choices` is null here and filled from `vocabs/categories.ttl` at
    // startup, the same arrangement the profile fields use. A list of
    // categories in JavaScript would be a copy of the scheme, which is exactly
    // the mistake the scheme was moved out of JavaScript to undo.
    vocabulary: 'categories', choices: null,
    help: 'Which kind of plugin it is. Pick the closest — a moderator can refine it.'
  },
  depiction: {
    predicate: `${foaf}depiction`, label: 'Picture', kind: 'url', required: false,
    // Uploaded, never typed. `Corrections` marks this predicate `viaForm: false`
    // for the same reason: a URL box would invite a link to somebody else's
    // server, and a hotlinked screenshot is a picture that can vanish, change,
    // or refuse to load for half the readers. The catalogue stores what it
    // shows, content-addressed and same-origin.
    //
    // So the form draws an upload rather than an input, and this field carries
    // the address of what was stored. `sh:nodeKind sh:IRI` and `sh:maxCount 1`
    // in vocabs/shapes.ttl are what actually hold the line.
    upload: true,
    help: 'A screenshot or the plugin\'s own artwork. Stored here rather than linked, so it keeps working.'
  },
  licenceId: {
    // `licence`, not `text`: the value is normalised through the same function
    // the harvesters use, so a submission cannot introduce a spelling the
    // catalogue already has under another name.
    predicate: `${pu}licenceId`, label: 'Licence', kind: 'licence', required: false,
    // Chosen, not typed. `pu:licenceId` is enumerated by `sh:in` in
    // vocabs/shapes.ttl, so a typed value that is not on the list fails
    // validation *after* somebody has filled the form in — and the whole reason
    // the enumeration exists is that 23 spellings had become 19 licences. A
    // form offering the list cannot produce a twentieth.
    //
    // Derived from `LICENCE_IDS` rather than written out here: the identifiers,
    // the SHACL enumeration and this list are one list, which is the arrangement
    // that stopped this class of defect recurring.
    choices: SELECTABLE_LICENCES,
    help: 'The licence it is released under, if you know it. Leave blank if not.'
  },

  // ── What the plugin does, which only its author really knows ─────────────
  //
  // Everything above is what a stranger can see from a download page. What
  // follows is the profile proper, and it is why this catalogue can answer
  // "what should I put before this?" rather than only "what is it called?".
  //
  // `choices` is left null here and filled from `vocabs/trn-profile.ttl` at
  // startup — see `withProfileVocabulary`. A list of roles written out in
  // JavaScript would be a copy of the ontology, which is the mistake the
  // category scheme already made once.
  role: {
    predicate: `${trn}role`, label: 'Roles', kind: 'profileTerm', required: false,
    multiple: true, choices: null, vocabulary: 'roles',
    help: 'What kind of thing it is. More than one is normal — a synth is usually both an Instrument and an Audio Instrument.'
  },
  accepts: {
    predicate: `${trn}accepts`, label: 'Accepts', kind: 'profileTerm', required: false,
    multiple: true, choices: null, vocabulary: 'signals',
    help: 'What you can feed it. This is half of what makes a chain suggestable: a plugin that accepts MIDI and produces audio goes after one that produces MIDI.'
  },
  produces: {
    predicate: `${trn}produces`, label: 'Produces', kind: 'profileTerm', required: false,
    multiple: true, choices: null, vocabulary: 'signals',
    help: 'What comes out. The other half.'
  },
  requires: {
    predicate: `${trn}requires`, label: 'Requires', kind: 'profileTerm', required: false,
    multiple: true, choices: null, vocabulary: 'requirements',
    help: 'Anything it needs from the host or from hardware to work properly.'
  },
  platform: {
    // The one fact on this form that only its author can state with certainty,
    // and the one a reader wants first. For 559 harvested plugins it is read
    // out of the packages; for a plugin somebody is submitting there are no
    // packages yet, so if it is not asked here it is not known at all.
    //
    // `pu:`, not `trn:` — hence its own kind rather than `profileTerm`, which
    // mints into `trn:` and would produce `trn:Windows`, a term no vocabulary
    // defines and every shape rejects.
    predicate: `${pu}supportedPlatform`, label: 'Platforms', kind: 'platform', required: false,
    multiple: true, choices: null, vocabulary: 'platforms',
    help: 'Which operating systems it runs on. Tick all that apply, and leave them all clear if you are not sure — blank means "nobody has said", which is what the catalogue would rather record than a guess.'
  },
  caution: {
    predicate: `${trn}caution`, label: 'Caution', kind: 'text', required: false,
    help: 'Anything that surprises people — heavy CPU at high settings, output that can jump in level, a parameter best left alone while playing.'
  }
})

/**
 * `SUBMITTABLE` with the profile fields' choices filled from the vocabulary.
 *
 * The field table is static because the validator, the serialiser and the tests
 * all need it without doing IO; the *choices* come from `vocabs/trn-profile.ttl`
 * because a list of roles in JavaScript is a second copy of an ontology. This
 * joins the two, once, at startup.
 */
/**
 * The kinds whose values are vocabulary terms a page renders by label.
 *
 * `trn:ControlMidi` reads "Control MIDI" and `pu:MacOS` reads "macOS"; both
 * come from `rdfs:label` in the file that defines them, by way of
 * `profileLabels`. Everything else either has no label to render — a licence
 * identifier is what it is — or has its own pages, as categories do.
 */
const LABELLED_KINDS = Object.freeze(new Set(['profileTerm', 'platform']))

export function withProfileVocabulary (vocabulary) {
  return Object.freeze(Object.fromEntries(
    Object.entries(SUBMITTABLE).map(([name, spec]) => {
      if (!spec.vocabulary) return [name, spec]
      const terms = vocabulary[spec.vocabulary]
      if (!terms) {
        throw new Error(
          `${name} takes its choices from the "${spec.vocabulary}" vocabulary, which was not supplied.`)
      }
      // `terms` carries the label a reader sees and is kept for the fields
      // whose values a *page* has to render, because `profileLabels` turns it
      // into the term lookup used across the site. Categories are excluded:
      // they have their own scheme, their own pages and their own labels, and a
      // category slug in that map would be a second namespace sharing one
      // lookup keyed by bare local name — `reverb` the category and a `trn:`
      // term of the same name would be indistinguishable.
      //
      // Platforms are in it, and they are the second namespace the paragraph
      // above warns about — so the guard in `profileLabels` refuses a local
      // name claimed twice rather than leaving it to be noticed on a page.
      return [name, LABELLED_KINDS.has(spec.kind)
        ? { ...spec, choices: terms.map(term => term.value), terms }
        : { ...spec, choices: terms.map(term => term.value), labels: terms }]
    })
  ))
}

/**
 * The field table with every vocabulary filled in — the one way to build it.
 *
 * `withProfileVocabulary` takes the vocabularies as an argument because the
 * composition has to be testable without IO. This is the composition itself,
 * and it exists so there is exactly one of it: the moment categories joined
 * roles and signal types, six places were each assembling
 * `withProfileVocabulary(await loadProfileVocabulary())` and every one of them
 * would have had to learn about the new vocabulary separately. Five were tests,
 * which is the good case — they failed. A seventh caller would not have.
 *
 * Categories are sorted by the label a reader sees, because this becomes a
 * dropdown and slug order is not the order anybody scans.
 */
export async function loadSubmittable () {
  const [profile, platforms, scheme] = await Promise.all([
    loadProfileVocabulary(),
    loadPlatformVocabulary(),
    CategoryScheme.load()
  ])
  return withProfileVocabulary({
    ...profile,
    ...platforms,
    categories: [...scheme.concepts.values()]
      .map(concept => ({ value: concept.slug, label: concept.prefLabel }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })
}

/**
 * What each profile term is called, for the pages that display one.
 *
 * Built from the same filled field table the form is built from, rather than
 * from a second read of the vocabulary — so a vendor who ticks "Control MIDI"
 * on `/submit` sees "Control MIDI" on the plugin page afterwards, and the two
 * cannot come to disagree. `trn:ControlMidi` rendered as "ControlMidi" was the
 * defect: `rdfs:label` had said "Control MIDI" since Phase 0 and the page had
 * never asked.
 *
 * The *token* stays the local name everywhere it is a key — the `?role=` in a
 * URL, the value in JSON, what the lexical index tokenises. Only the text a
 * person reads changes, which is why this is a lookup at render time and not a
 * different value on the document.
 *
 * @param {object} submittable - a field table from `withProfileVocabulary`
 * @returns {Map<string, string>} local name to label
 */
export function profileLabels (submittable) {
  const labels = new Map()
  for (const [name, spec] of Object.entries(submittable)) {
    // Labelled kinds only. This map is keyed by bare local name, so a category
    // slug in it would be a second namespace sharing one lookup — and `reverb`
    // the category and a `trn:` term of the same name would be
    // indistinguishable.
    if (!LABELLED_KINDS.has(spec.kind)) continue
    for (const term of spec.terms ?? []) {
      // Two namespaces do share this map — `trn:` behaviour terms and `pu:`
      // platforms — and they are disjoint today. A collision would not fail
      // anywhere: one label would quietly win and a page would render the
      // wrong word for a term, which is the class of defect nothing in this
      // project notices. So it is an error at startup instead.
      const seen = labels.get(term.value)
      if (seen !== undefined && seen !== term.label) {
        throw new Error(
          `Two vocabularies both define "${term.value}" — "${seen}" and "${term.label}" ` +
          `(${name}). This map is keyed by local name, so one would silently win. ` +
          'Rename the term, or give platforms a lookup of their own.')
      }
      labels.set(term.value, term.label)
    }
  }
  return labels
}

/** The object term a submitted value becomes, by kind. */
export function valueTerm (kind, value) {
  if (kind === 'url') return iri(value)
  if (kind === 'category') return iri(`${pu}category/${value}`)
  // A format and a profile term are both bare local names in the trn:
  // namespace — VST3, AudioEffect, ControlMidi — so they mint the same way.
  if (kind === 'format' || kind === 'profileTerm') return iri(`${trn}${value}`)
  // A platform is the same shape in the other namespace: Windows, MacOS, Linux
  // are individuals of pu:Platform. Minting one into trn: would produce a term
  // nothing defines, which `vocabs/shapes.ttl` would refuse after the form had
  // been filled in — the failure mode the enumeration exists to prevent.
  if (kind === 'platform') return iri(`${pu}${value}`)
  return literal(value)
}

/**
 * Check a submission before anything is minted or written.
 *
 * Every message is shown to the person who typed it, so each says what to do
 * rather than what went wrong.
 */
/**
 * @param {object} fields - what was typed
 * @param {object} [submittable] - the field table, with profile choices filled
 *   from the vocabulary. Defaults to the bare one, which has no choices on the
 *   profile fields — so a caller that forgets gets a refusal naming the cause
 *   rather than an unchecked value reaching the store.
 */
export function validate (fields = {}, submittable = SUBMITTABLE) {
  const clean = {}
  for (const [key, spec] of Object.entries(submittable)) {
    // A field that takes several values arrives as an array from a checkbox
    // group, and as a single string from anything else. Normalised once here
    // so the rest of this function, and everything downstream, sees one shape.
    if (spec.multiple) {
      const values = [...new Set(
        (Array.isArray(fields[key]) ? fields[key] : [fields[key]])
          .map(value => String(value ?? '').trim())
          .filter(Boolean)
      )]
      if (values.length === 0) {
        if (spec.required) throw new SubmissionError(`${spec.label} are needed. ${spec.help}`)
        continue
      }
      for (const value of values) {
        if (spec.kind === 'format' && !PLUGIN_FORMATS.includes(value)) {
          throw new SubmissionError(
            `"${value}" is not a format this catalogue knows. Known: ${PLUGIN_FORMATS.join(', ')}.`)
        }
        // Checked against the *offered* list rather than a copy, so a form
        // built from the vocabulary and a validator checking the vocabulary
        // cannot disagree. A submission naming a term the shapes would reject
        // is refused here, where the person can still fix it.
        //
        // A platform is checked the same way and against the same kind of
        // list, read from `vocabs/plugin-universe.ttl` rather than written out
        // here. `sh:in` on `pu:supportedPlatform` enumerates the three, so an
        // unchecked value would fail validation after somebody had filled the
        // form in — and "win" alongside "Windows" is exactly the facet-splitting
        // the enumeration exists to stop.
        if (spec.kind === 'profileTerm' || spec.kind === 'platform') {
          if (!spec.choices) {
            throw new SubmissionError(
              `${spec.label} cannot be checked: the profile vocabulary was not loaded.`)
          }
          if (!spec.choices.includes(value)) {
            throw new SubmissionError(
              `"${value}" is not a ${spec.label.toLowerCase().replace(/s$/, '')} this catalogue knows. ` +
              `Known: ${spec.choices.join(', ')}.`)
          }
        }
      }
      clean[key] = values
      continue
    }

    const raw = String(fields[key] ?? '').trim()
    if (!raw) {
      if (spec.required) throw new SubmissionError(`${spec.label} is needed. ${spec.help}`)
      continue
    }
    if (raw.length > CONTRIBUTION_CONFIG.maxValueLength) {
      throw new SubmissionError(`${spec.label} is longer than ${CONTRIBUTION_CONFIG.maxValueLength} characters.`)
    }
    if (spec.kind === 'url') {
      let url
      try {
        url = new URL(raw)
      } catch {
        throw new SubmissionError(`${spec.label} must be a full URL, starting http:// or https://.`)
      }
      if (!/^https?:$/.test(url.protocol)) {
        throw new SubmissionError(`${spec.label} must be an http or https URL.`)
      }
    }
    if (spec.kind === 'category') {
      if (!/^[a-z0-9-]+$/.test(raw)) {
        throw new SubmissionError('A category is lowercase letters, digits and hyphens, like "reverb".')
      }
      // Checked against the scheme, not just the shape of the string.
      //
      // The regex alone accepted "revrb", "delayy" or anything else spelled
      // plausibly, and minted `pu:category/<that>` — a concept with no
      // definition, which `tests/store/categories.test.js` reports as
      // undescribed long after the person who could have corrected it has gone.
      // The same list the form offers, so the two cannot disagree.
      if (!spec.choices) {
        throw new SubmissionError(
          `${spec.label} cannot be checked: the category scheme was not loaded.`)
      }
      if (!spec.choices.includes(raw)) {
        throw new SubmissionError(
          `"${raw}" is not a category this catalogue has. Known: ${spec.choices.join(', ')}.`)
      }
    }
    if (spec.kind === 'format' && !/^[A-Za-z0-9]+$/.test(raw)) {
      throw new SubmissionError('A format is a name like VST3, LV2 or CLAP.')
    }
    if (spec.kind === 'licence') {
      // Normalised, not merely checked: someone typing GPLv3 gets GPL-3.0
      // recorded rather than a second name for a licence already in the
      // catalogue. Unrecognised is refused here because there is a person to
      // tell — a harvester, with nobody to ask, keeps the raw string instead.
      const spdx = toKnownSpdx(raw)
      if (!spdx) {
        throw new SubmissionError(
          `"${raw}" is not a licence identifier the catalogue recognises. Use the SPDX form, such as GPL-3.0, MIT or Apache-2.0, or leave it blank.`)
      }
      clean[key] = spdx
      continue
    }
    clean[key] = raw
  }
  return clean
}

export class Submissions {
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
    // The field table with profile choices filled in. Defaults to the bare one,
    // which cannot check a profile term and says so.
    submittable = SUBMITTABLE,
    queries = new QueryService(),
    queueGraph = GraphRegistry.graphIri('system', 'submissions')
  } = {}) {
    if (!client) throw new SubmissionError('Submissions needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    // The SHACL shapes, when the caller supplies them. A submission is checked
    // against the same shapes a harvest is, because a plugin a person typed is
    // not a different kind of plugin.
    this.validator = validator
    this.queries = queries
    this.submittable = submittable
    this.queueGraph = queueGraph
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', 'submissions')) return this.queueGraph
    return this.registry.register({
      kind: 'system',
      id: 'submissions',
      // The same flag the corrections queue carries, and for the same reason: a
      // proposal names the person who made it, so the queue is personal data
      // until it is accepted and its factual part moves to a CC0 graph.
      licence: 'personal-data',
      derivedFrom: `${pu}submissions`,
      comment: 'Proposed plugins, pending review. Not catalogue data until accepted.'
    })
  }

  /** The IRI this submission will mint, so a duplicate can be found before writing. */
  pluginIriFor (fields) {
    return this.minter.mintPlugin({
      name: fields.name,
      vendor: fields.vendor,
      // The homepage stands in for a canonical source IRI. It is the only
      // stable identifier a person can supply, and hashing it is what makes
      // two submissions of one plugin collide rather than duplicate.
      sourceIri: fields.homepage
    })
  }

  /** Whether the catalogue already holds a plugin at this IRI. */
  async exists (pluginIri) {
    const rows = await this.client.select(
      this.queries.get('contrib/plugin-exists', { plugin: iri(pluginIri) }))
    return rows.length > 0
  }

  /** The triples an accepted submission becomes. */
  triplesFor (pluginIri, fields, now) {
    const s = iri(pluginIri)
    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(trn + 'PluginProfile')} .`,
      // First seen now, because this is when the catalogue first saw it. A
      // re-harvest preserves this; nothing else writes it again.
      `${s} ${iri(NAMESPACES.dcterms + 'created')} ${typedLiteral(now)} .`
    ]
    for (const [key, spec] of Object.entries(this.submittable)) {
      if (!fields[key]) continue
      for (const value of [fields[key]].flat()) {
        triples.push(`${s} ${iri(spec.predicate)} ${valueTerm(spec.kind, value)} .`)
      }
    }
    return triples
  }

  /**
   * Propose a plugin.
   *
   * Order matters here: validate, mint, check for a duplicate, check the
   * shapes, and only then write. Each of those can refuse, and refusing before
   * anything is written is what makes a failed submission leave no trace.
   */
  async submit ({ account, fields }, now = new Date()) {
    if (!account) throw new SubmissionError('Sign in to submit a plugin.')
    if (account.suspended) throw new SubmissionError('This account is suspended.')

    const recent = await this.recentCount(account.iri, now)
    if (recent >= CONTRIBUTION_CONFIG.perAccountPerHour) {
      throw new SubmissionError(
        `That is ${CONTRIBUTION_CONFIG.perAccountPerHour} contributions in an hour, which is the limit. ` +
        'Please come back shortly.')
    }

    const clean = validate(fields, this.submittable)
    const pluginIri = this.pluginIriFor(clean)

    if (await this.exists(pluginIri)) {
      throw new SubmissionError(
        'The catalogue already has this plugin — the name, vendor and homepage match one it holds.',
        { existing: pluginIri })
    }
    const queued = await this.pendingFor(pluginIri)
    if (queued) {
      throw new SubmissionError(
        'Somebody has already proposed this plugin and it is waiting to be reviewed.',
        { existing: pluginIri })
    }

    const triples = this.triplesFor(pluginIri, clean, now)
    if (this.validator) {
      const report = await this.validator.validateTriples(triples)
      if (!report.conforms) {
        throw new SubmissionError(
          `That does not make a valid plugin record: ${report.results[0].message}`)
      }
    }

    await this.ensureGraph()
    const trusted = account.trustLevel === TRUST.TRUSTED || account.trustLevel === TRUST.MODERATOR
    const status = trusted ? STATUS.ACCEPTED : STATUS.PENDING
    const node = this.minter.mint('correction', `submission-${now.getTime()}`,
      [account.iri, pluginIri, String(now.getTime())])
    const q = iri(node)

    const record = [
      `${q} ${iri(rdf + 'type')} ${iri(pu + 'Submission')} .`,
      `${q} ${iri(pu + 'proposedPlugin')} ${iri(pluginIri)} .`,
      `${q} ${iri(pu + 'submissionStatus')} ${literal(status)} .`,
      `${q} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${q} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    ]
    for (const [key, spec] of Object.entries(this.submittable)) {
      if (!clean[key]) continue
      // One node per value, not per field: a plugin built for VST3 and LV2 is
      // two proposed formats, and a single node would have kept whichever was
      // written last.
      for (const [index, value] of [clean[key]].flat().entries()) {
        const field = `_:f${key}${index}`
        record.push(
          `${q} ${iri(pu + 'proposedField')} ${field} .`,
          `${field} ${iri(pu + 'fieldPredicate')} ${literal(spec.predicate)} .`,
          `${field} ${iri(pu + 'fieldValue')} ${literal(value)} .`)
      }
    }
    // One request: the blank nodes above are scoped to it, and splitting them
    // across two would leave half a submission with no fields.
    await this.client.update(insertDataQuery(this.queueGraph, record))

    if (status === STATUS.ACCEPTED) await this.apply(node, pluginIri, clean, account, now)
    return { iri: node, plugin: pluginIri, status, fields: clean }
  }

  /**
   * Write an accepted submission into the contributor's CC0 graph.
   *
   * The plugin becomes catalogue data at this moment and not before. It lands
   * in the contributor's own graph, so withdrawing it later is a DROP of one
   * graph rather than a repair of the catalogue.
   */
  async apply (submissionIri, pluginIri, fields, account, now = new Date()) {
    const graphs = await ensureContributorGraphs(this.registry, account)
    await this.client.update(
      insertDataQuery(graphs.facts, this.triplesFor(pluginIri, fields, now)))
    return graphs.facts
  }

  /** Submissions by this account in the last hour, counted from the store. */
  async recentCount (accountIri, now = new Date()) {
    const since = new Date(now.getTime() - 3600000)
    const rows = await this.client.select(this.queries.get('contrib/submission-recent', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      since: typedLiteral(since)
    }))
    return rows.length
  }

  /**
   * Proposed plugins awaiting review, oldest first, grouped one per submission.
   *
   * SPARQL returns a row per proposed field; a submission is reviewed whole, so
   * the rows are folded back into one record here rather than shown as several
   * things a moderator could decide separately.
   */
  async pending (limit = 50) {
    const rows = await this.client.select(this.queries.get('contrib/submissions-pending', {
      queueGraph: iri(this.queueGraph),
      status: literal(STATUS.PENDING)
    }))
    const byIri = new Map()
    for (const row of rows) {
      if (!byIri.has(row.submission)) {
        byIri.set(row.submission, {
          submission: row.submission, plugin: row.plugin, by: row.by, at: row.at, fields: {}
        })
      }
      const key = Object.keys(this.submittable).find(name => this.submittable[name].predicate === row.predicate)
      if (!key) continue
      const record = byIri.get(row.submission).fields
      if (SUBMITTABLE[key].multiple) (record[key] ??= []).push(row.value)
      else record[key] = row.value
    }
    return [...byIri.values()].slice(0, limit)
  }

  /**
   * Accept or reject a proposed plugin.
   *
   * Accepting re-validates rather than trusting what was stored: the whitelist
   * may have changed since it was proposed, and this writes into a public
   * graph. A rejection writes nothing anywhere — the proposal was never in the
   * catalogue to begin with, which is the advantage of holding the fields on
   * the submission rather than writing them provisionally.
   */
  async review ({ submissionIri, moderator, accept, accounts }, now = new Date()) {
    if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
      throw new SubmissionError('Only a moderator can review submissions.')
    }
    const rows = await this.client.select(this.queries.get('contrib/submission-fields', {
      queueGraph: iri(this.queueGraph),
      submission: iri(submissionIri),
      status: literal(STATUS.PENDING)
    }))
    if (rows.length === 0) {
      throw new SubmissionError('That submission is not pending; it may already have been decided.')
    }

    if (!accept) {
      await this.#setStatus(submissionIri, STATUS.REJECTED, moderator, now)
      return { status: STATUS.REJECTED, promoted: false }
    }

    const contributor = await accounts.find(rows[0].by)
    if (!contributor) throw new SubmissionError('The contributor no longer has an account.')

    const fields = {}
    for (const row of rows) {
      const key = Object.keys(this.submittable).find(name => this.submittable[name].predicate === row.predicate)
      if (!key) continue
      if (SUBMITTABLE[key].multiple) (fields[key] ??= []).push(row.value)
      else fields[key] = row.value
    }
    const clean = validate(fields, this.submittable)
    const pluginIri = rows[0].plugin

    // Checked again here as well as at submission: time has passed, and the
    // catalogue may have harvested the same plugin in between.
    if (await this.exists(pluginIri)) {
      await this.#setStatus(submissionIri, STATUS.REJECTED, moderator, now)
      throw new SubmissionError(
        'The catalogue has acquired this plugin since it was proposed, so the submission has been closed.',
        { existing: pluginIri })
    }

    await this.apply(submissionIri, pluginIri, clean, contributor, now)
    await this.#setStatus(submissionIri, STATUS.ACCEPTED, moderator, now)

    const promoted = await accounts.promoteIfEarned(
      contributor, await this.acceptedCount(contributor.iri))
    return { status: STATUS.ACCEPTED, promoted, contributor: contributor.login, plugin: pluginIri }
  }

  async #setStatus (submissionIri, status, moderator, now) {
    await this.client.update(this.queries.get('contrib/submission-set-status', {
      queueGraph: iri(this.queueGraph),
      submission: iri(submissionIri),
      status: literal(status),
      moderator: iri(moderator.iri),
      at: typedLiteral(now)
    }))
  }

  /** How many of this account's submissions have been accepted. */
  async acceptedCount (accountIri) {
    const rows = await this.client.select(this.queries.get('contrib/submission-accepted-count', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      status: literal(STATUS.ACCEPTED)
    }))
    return rows.length
  }

  /** The pending submission for a plugin IRI, if there is one. */
  async pendingFor (pluginIri) {
    const rows = await this.client.select(this.queries.get('contrib/submission-pending-for', {
      queueGraph: iri(this.queueGraph),
      plugin: iri(pluginIri),
      status: literal(STATUS.PENDING)
    }))
    return rows[0]?.submission ?? null
  }
}

export default Submissions
