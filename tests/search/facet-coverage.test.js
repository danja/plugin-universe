import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { FACET_PATTERNS } from '../../src/search/SearchService.js'
import { FACET_NAMES } from '../../src/api/server.js'
import { renderPluginPage } from '../../src/api/render.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A facet that is accepted and not applied, and a fact that is stored and not
 * read.
 *
 * Both were live here. `/plugins` read `?category=` off the request and
 * filtered nothing, because the facet list was written out three times and one
 * copy had fallen behind — fixed by `FACET_NAMES`. But `FACET_NAMES` only made
 * the *names* one list: the filter that turns a name into a graph pattern was
 * still a chain of `if`s, so a name added to the list and not to the chain
 * would have been read, accepted, and silently ignored. Exactly the earlier
 * symptom, one layer down.
 *
 * And `trn:accepts`, `trn:produces` and `trn:requires` have been written by
 * every harvester since Phase 0 — 181, 189 and 57 plugins carry them — while
 * `plugin/text-view.sparql` did not select them. They were in the store, on no
 * page, and reachable by no query. Nothing failed, because nothing asked.
 *
 * So this file asserts the joins rather than the parts: name to pattern, query
 * to document, document to page.
 */

const DOC = {
  iri: `${NAMESPACES.pu}plugin/chainer-00000000`,
  name: 'Chainer',
  vendor: 'A Vendor',
  description: 'Reshapes an incoming note stream.',
  roles: ['MidiEffect'],
  accepts: ['Midi', 'ControlMidi'],
  produces: ['Midi'],
  requires: ['HostTransport'],
  formats: [],
  categories: [],
  tags: [],
  parameters: [],
  sameAs: [],
  cautions: null
}

describe('every facet the API accepts is a facet the filter applies', () => {
  it('has one pattern per name, and no name without one', () => {
    // The assertion that makes the two lists one. A facet added to
    // FACET_NAMES without a FACET_PATTERNS entry fails here rather than
    // shipping as a query parameter that does nothing.
    expect(Object.keys(FACET_PATTERNS).sort()).toEqual([...FACET_NAMES].sort())
  })

  it('builds a real graph pattern for each, naming the predicate it filters on', () => {
    const predicates = {
      format: `${NAMESPACES.trn}format`,
      role: `${NAMESPACES.trn}role`,
      accepts: `${NAMESPACES.trn}accepts`,
      produces: `${NAMESPACES.trn}produces`,
      category: `${NAMESPACES.pu}category`,
      vendor: `${NAMESPACES.trn}vendor`,
      source: `${NAMESPACES.pu}sourceAvailability`,
      pricing: `${NAMESPACES.pu}pricing`,
      licence: `${NAMESPACES.pu}licenceId`,
      measured: `${NAMESPACES.pu}ValidationResult`
    }
    for (const [name, build] of Object.entries(FACET_PATTERNS)) {
      const pattern = build('Whatever')
      expect(pattern, `${name} builds nothing`).toBeTruthy()
      expect(pattern, `${name} does not name its predicate`).toContain(predicates[name])
      expect(pattern, `${name} does not use the value`).toContain('Whatever')
    }
  })

  it('scopes a plugin property to the plugin\'s own graph, and a measurement to the run\'s', () => {
    // `?g` is bound to the graph the plugin came from, so reusing it is what
    // stops a facet matching across two sources. A verdict is the exception:
    // it lives in the profiler's run graph and is joined, not filtered.
    expect(FACET_PATTERNS.format('LV2')).toContain('GRAPH ?g {')
    expect(FACET_PATTERNS.measured('passed')).toContain('GRAPH ?measurements {')
    expect(FACET_PATTERNS.measured('passed')).not.toContain('GRAPH ?g {')
  })

  it('mints a signal type back into trn: rather than trusting the URL', () => {
    // The value in the URL is a local name so the address reads as a question.
    // A name the vocabulary does not define becomes an IRI nothing carries and
    // matches nothing — the right answer to a typed-in URL, and not an error.
    expect(FACET_PATTERNS.accepts('Midi')).toContain(`<${NAMESPACES.trn}Midi>`)
    expect(FACET_PATTERNS.produces('Audio')).toContain(`<${NAMESPACES.trn}Audio>`)
  })
})

describe('the pages that promise this', () => {
  it('only names facets that exist', () => {
    // `/about/profiles` asks vendors to fill these fields in and tells them
    // what they get for it, including a URL. A published promise that drifts
    // silently is worse than none — the same reason
    // `tests/search/promotion.test.js` binds `/about/promotion` to its numbers.
    const prose = readFileSync('docs/profiles.md', 'utf8')
    for (const [, name] of prose.matchAll(/\/\?([a-z]+)=/g)) {
      expect(FACET_NAMES, `docs/profiles.md offers /?${name}= and there is no such facet`)
        .toContain(name)
    }
  })
})

describe('what the profile says reaches the page', () => {
  const query = readFileSync('sparql/queries/plugin/text-view.sparql', 'utf8')

  it('selects the three behavioural predicates the harvesters write', () => {
    // The half that was missing. Without these the facts sat in the store and
    // no page, no facet and no API response could reach them.
    for (const term of ['trn:accepts', 'trn:produces', 'trn:requires']) {
      expect(query, `text-view does not read ${term}`).toContain(term)
    }
    for (const name of ['?accepts', '?produces', '?requires']) {
      expect(query, `text-view does not project ${name}`).toContain(`AS ${name}`)
    }
  })

  it('groups them, so a plugin with two of something is still one row', () => {
    // GROUP_CONCAT rather than a join explosion: a plugin accepting audio and
    // MIDI must not become two documents.
    for (const name of ['?acceptsLabel', '?producesLabel', '?requiresLabel']) {
      expect(query).toContain(`GROUP_CONCAT(DISTINCT ${name}`)
    }
  })

  it('shows all three on a plugin page', () => {
    const page = renderPluginPage(DOC)
    expect(page).toContain('Accepts')
    expect(page).toContain('Produces')
    expect(page).toContain('Requires')
    expect(page).toContain('ControlMidi')
    expect(page).toContain('HostTransport')
  })

  it('links each side of the chain to the other', () => {
    // The point of showing them. What this plugin accepts links to what
    // produces it — "what goes before this?" — and what it produces links to
    // what accepts it. Linking accepts to accepts would list its siblings,
    // which is a different and much less useful question.
    const page = renderPluginPage(DOC)
    expect(page).toContain('/?produces=Midi')
    expect(page).toContain('/?produces=ControlMidi')
    expect(page).toContain('/?accepts=Midi')
  })

  it('does not link a requirement anywhere', () => {
    // Nothing produces a host transport, so there is no opposite side, and
    // there is no `requires=` facet. A link resolving to an empty result is
    // worse than plain text.
    const page = renderPluginPage(DOC)
    expect(page).not.toContain('requires=HostTransport')
    expect(page).not.toContain('q=HostTransport')
  })

  it('omits a row rather than showing an empty one', () => {
    const bare = renderPluginPage({ ...DOC, accepts: [], produces: [], requires: [] })
    expect(bare).not.toContain('Accepts')
    expect(bare).not.toContain('Produces')
    expect(bare).not.toContain('Requires')
  })
})
