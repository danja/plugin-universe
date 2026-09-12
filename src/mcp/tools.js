import { z } from 'zod'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * The catalogue as tools an agent can call.
 *
 * `docs/architecture.md` §4 calls the MCP face the differentiator for the third
 * audience: people are served by the web UI, programs by the REST API, and
 * agents by this. It is the same `SearchService` behind all three, so an agent
 * gets the hybrid retrieval rather than a keyword match over a JSON file.
 *
 * **Read-only, and no account.** Every tool here answers questions about a CC0
 * catalogue. Nothing writes, nothing needs a session, and the SPARQL tool runs
 * against the *published* dataset rather than the live store — so the one tool
 * that can express an arbitrary query cannot express one that reaches personal
 * data, because that data is not in the dataset it queries.
 *
 * Descriptions are written for a reader who cannot see the site. An agent
 * choosing between tools has only these sentences to go on, so each says what
 * the tool is for and what it is not.
 */

/**
 * The catalogue's own terms, carried on every response as `catalogueLicence`.
 *
 * Never `licence`. A plugin record already has a `licence` — the plugin's own,
 * which is its author's and a different fact entirely — and naming this one the
 * same thing put the catalogue's terms on top of it in `get_plugin`, so every
 * plugin came back as CC0 whatever its licence actually was. A licence is
 * precisely the claim an agent must not be handed wrong.
 */
const LICENCE_NOTE =
  'Catalogue facts are CC0 (public domain); attribution to Plugin Universe ' +
  '(https://plugin-universe.com) is requested but not required.'

/** A tool result, in the shape MCP expects. */
function text (value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function failure (message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** One search result, trimmed to what an agent can act on. */
function summarise (result) {
  return {
    name: result.name,
    vendor: result.vendor ?? null,
    description: result.description ?? null,
    slug: result.iri.split('/').pop(),
    iri: result.iri,
    formats: result.formats ?? [],
    categories: result.categories ?? [],
    licence: result.licenceId ?? null,
    price: result.pricing ?? null,
    source: result.sourceAvailability ?? null,
    homepage: result.homepage ?? null,
    // Disclosed to an agent as plainly as to a reader. An agent summarising
    // these results for somebody is the case where an unlabelled paid
    // placement does the most damage, because the label cannot be noticed
    // later — it has to be in the data or it is gone.
    ...(result.promoted ? { promoted: true, promotedNote: PROMOTION_NOTE } : {}),
    ...(result.score === undefined ? {} : { score: Number(result.score.toFixed(3)) })
  }
}

/**
 * What `promoted: true` means, in the payload rather than in documentation.
 *
 * An agent that has to fetch a page to learn what a field means will not fetch
 * it, and will pass the result on as though it were ranked on merit alone.
 */
const PROMOTION_NOTE =
  'Paid placement. This result is boosted in ranking because it is paid for. ' +
  'The ranking effect is bounded and published at https://plugin-universe.com/about/promotion'

export function registerTools (server, { search, publication = null }) {
  server.registerTool('search_plugins', {
    title: 'Search plugins',
    description:
      'Find audio plugins by what they do, not just by name. Hybrid retrieval: ' +
      'a semantic match over each plugin\'s description, parameters and category ' +
      'labels, fused with a lexical match on names and vendors. Ask the way a ' +
      'musician would — "warm analogue bus compressor", "transport-synced MIDI ' +
      'modulator". Facets narrow the result set and never re-rank it. Returns ' +
      'ranked summaries; call get_plugin for the full record.',
    inputSchema: {
      query: z.string().describe('What the plugin should do, in plain language. Optional if a facet is given.').optional(),
      format: z.string().describe('Plugin format, e.g. VST3, LV2, CLAP, AudioUnit.').optional(),
      category: z.string().describe('Category slug, e.g. reverb, compressor, synth. Use list_categories to see them.').optional(),
      pricing: z.string().describe('Free, Donationware, Freemium or Paid.').optional(),
      source: z.string().describe('OpenSource, SourceAvailable or Proprietary.').optional(),
      limit: z.number().int().min(1).max(RETRIEVAL_CONFIG.maxPageSize).optional()
    }
  }, async ({ query, limit, ...facets }) => {
    const chosen = Object.fromEntries(Object.entries(facets).filter(([, value]) => value))
    if (!query && Object.keys(chosen).length === 0) {
      return failure('Give a query, or at least one of format, category, pricing or source.')
    }
    const size = limit ?? 10
    const outcome = query
      ? await search.search(query, { facets: chosen, limit: size })
      : await search.browse({ facets: chosen, limit: size, order: 'recent' })

    return text({
      query: query ?? null,
      facets: chosen,
      total: outcome.total,
      results: outcome.results.map(summarise),
      catalogueLicence: LICENCE_NOTE
    })
  })

  server.registerTool('get_plugin', {
    title: 'Get one plugin',
    description:
      'Everything the catalogue holds about one plugin: description, vendor, ' +
      'formats, parameters, licence, where the facts came from, and any ' +
      'measurements a profiler has taken of the built binary. Takes the slug ' +
      'from a search result, or the full catalogue IRI.',
    inputSchema: {
      plugin: z.string().describe('A slug like "wet-reverb-693085a0", or the full pu: IRI.')
    }
  }, async ({ plugin }) => {
    const iri = plugin.startsWith('http') ? plugin : `${NAMESPACES.pu}plugin/${plugin}`
    const doc = search.documents.get(iri)
    if (!doc) return failure(`No plugin with that identifier. Tried ${iri}. Use search_plugins to find one.`)

    const measured = search.measured(iri)
    return text({
      ...summarise(doc),
      tags: doc.tags ?? [],
      roles: doc.roles ?? [],
      parameters: doc.parameters ?? [],
      cautions: doc.cautions ?? null,
      firstSeen: doc.created ?? null,
      // Where each fact came from and under what terms. An agent repeating a
      // claim from here should be able to say where it got it.
      provenance: doc.provenance
        ? { source: doc.provenance.source, licence: doc.provenance.licence, derivedFrom: doc.provenance.derivedFrom }
        : null,
      // A measurement is a fact about one binary on one machine on one day, so
      // the tool and the host travel with the numbers.
      measurements: measured
        ? {
            verdict: measured.verdict,
            takenAt: measured.at,
            tool: measured.tool,
            platform: measured.platform,
            // The verdict is already above; repeating it as a reading invites
            // an agent to report the same fact twice.
            readings: measured.readings
              .filter(reading => reading.metric !== 'ValidationResult')
              .map(reading => ({
                metric: reading.label,
                value: reading.value,
                // Both: the symbol is what a sentence needs, the IRI is what a
                // program needs, and neither substitutes for the other.
                unit: reading.unit ? reading.unit.replace(/^.*[/#]/, '') : null,
                unitIri: reading.unit ?? null,
                note: reading.note ?? null
              }))
          }
        : null,
      page: `https://plugin-universe.com/plugin/${iri.split('/').pop()}`,
      turtle: `${iri.replace(NAMESPACES.pu, 'https://plugin-universe.com/')}.ttl`,
      // `catalogueLicence`, not `licence`. This object also carries the
      // *plugin's* licence, from summarise(), and a key named `licence` at this
      // level silently overwrote it — so every plugin came back as CC0,
      // including MIT and GPL ones. A licence is exactly the claim an agent
      // should not be given wrong, and the two are different facts: the
      // catalogue's terms cover the description, the plugin's cover the
      // software.
      catalogueLicence: LICENCE_NOTE
    })
  })

  server.registerTool('list_categories', {
    title: 'List categories',
    description:
      'The category scheme, with what each category means, what else it is ' +
      'called, and how they nest. Useful before filtering a search: the ' +
      'definitions say where the boundaries are, and the alternative labels ' +
      'are the words a person would use instead.',
    inputSchema: {}
  }, async () => text({
    categories: [...search.categories.values()].map(concept => ({
      slug: concept.slug,
      definition: concept.definition,
      alsoCalled: concept.altLabels,
      partOf: concept.broader,
      includes: concept.narrower,
      related: concept.related,
      note: concept.scopeNote ?? undefined
    })),
    catalogueLicence: LICENCE_NOTE
  }))

  // Only offered when a published dataset is configured. A SPARQL tool over the
  // live store would be a way to ask for accounts by name; over the published
  // copy there is nothing private to ask for.
  if (publication) {
    server.registerTool('sparql_query', {
      title: 'Query the catalogue with SPARQL',
      description:
        'Run a read-only SPARQL 1.1 SELECT or ASK against the published ' +
        'catalogue. The default graph is the union of every named graph, so a ' +
        'query with no GRAPH clause sees everything. Vocabularies: trn: for ' +
        'plugin profiles, pu: for measurements and packaging, lv2: and units: ' +
        'for parameters, skos: for categories. This is the published copy — it ' +
        'holds no accounts or contributor records, and it may lag the live ' +
        'catalogue by up to a day. Prefer search_plugins for anything a search ' +
        'can answer; this is for questions it cannot.',
      inputSchema: {
        query: z.string().describe('A SPARQL SELECT or ASK query.'),
        limit: z.number().int().min(1).max(500).describe('Maximum rows returned. Default 50.').optional()
      }
    }, async ({ query, limit }) => {
      if (/\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD)\b/i.test(query)) {
        // The endpoint has no update operation, so this would fail anyway. It
        // is refused here so the answer is a sentence rather than a stack of
        // protocol errors.
        return failure('This tool runs read-only queries. SELECT and ASK only.')
      }
      try {
        const rows = await publication.select(query)
        const capped = rows.slice(0, limit ?? 50)
        return text({
          rows: capped.length,
          truncated: rows.length > capped.length,
          results: capped,
          catalogueLicence: LICENCE_NOTE
        })
      } catch (error) {
        return failure(`The query was refused: ${error.message}`)
      }
    })
  }

  return server
}

export default registerTools
