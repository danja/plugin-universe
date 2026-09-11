import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import ShapeValidator from '../../src/store/ShapeValidator.js'
import Accounts, { TRUST } from '../../src/auth/Accounts.js'
import { STATUS } from '../../src/contrib/Corrections.js'
import Submissions, { SubmissionError } from '../../src/contrib/Submissions.js'
import { iri } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * Proposing a plugin, against the live store.
 *
 * Which graph a triple lands in is the whole design, and none of it is
 * observable through a mock: a pending submission must be in the queue and
 * nowhere else, and an accepted one must be in the contributor's CC0 graph.
 *
 * Test graph ids throughout. A suite that writes into the graph holding real
 * people's contributions to assert something about a fake one is a bad trade
 * whatever the cleanup does afterwards.
 */

const pu = NAMESPACES.pu
const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

const registry = new GraphRegistry(client, { metadataGraph: `${pu}test/submission-graphs` })
const accounts = new Accounts(client, { registry, graphId: 'test-sub-accounts' })

const CONTRIBUTOR = { githubId: '991001', login: 'test-submitter', name: 'A Submitter' }
const MODERATOR = { githubId: '991002', login: 'test-sub-moderator', name: 'A Moderator' }

const FIELDS = {
  name: 'Test Submission Plugin',
  homepage: 'https://example.invalid/test-submission-plugin',
  vendor: 'Test Vendor',
  format: ['VST3', 'LV2'],
  description: 'A plugin that exists only in this test.',
  category: 'reverb'
}

let clock = Date.now()
const tick = () => new Date(clock += 1000)

let submissions
let contributor
let moderator

async function cleanup () {
  for (const graph of [accounts.graph, submissions?.queueGraph, `${pu}test/submission-graphs`]) {
    if (graph) await client.update(`DROP SILENT GRAPH ${iri(graph)}`)
  }
  for (const identity of [CONTRIBUTOR, MODERATOR]) {
    const base = accounts.accountIri(identity.githubId).split('/').pop()
    for (const suffix of ['facts', 'prose']) {
      await client.update(`DROP SILENT GRAPH ${iri(GraphRegistry.graphIri('user', `${base}-${suffix}`))}`)
    }
  }
}

/** Everything anywhere in the store about this IRI, with the graph it is in. */
async function anywhere (pluginIri) {
  return client.select(
    `SELECT ?g ?p ?o WHERE { GRAPH ?g { ${iri(pluginIri)} ?p ?o } }`)
}

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  submissions = new Submissions(client, {
    registry,
    queueGraph: GraphRegistry.graphIri('system', 'test-submissions'),
    validator: await ShapeValidator.load()
  })
  await cleanup()
  await accounts.ensureGraph()
  await registry.register({
    kind: 'system',
    id: 'test-submissions',
    licence: 'personal-data',
    derivedFrom: `${pu}test-submissions`,
    comment: 'Test queue.'
  })
  contributor = await accounts.upsert(CONTRIBUTOR)
  const promoted = await accounts.upsert(MODERATOR)
  await accounts.setTrust(promoted.iri, TRUST.MODERATOR)
  moderator = await accounts.find(promoted.iri)
}, 120000)

afterAll(cleanup)

describe('a submission from a new contributor', () => {
  let result

  it('is queued rather than published', async () => {
    result = await submissions.submit({ account: contributor, fields: FIELDS }, tick())
    expect(result.status).toBe(STATUS.PENDING)

    // The whole point: the catalogue does not have it yet.
    const written = await anywhere(result.plugin)
    expect(written, 'a pending submission reached a public graph').toEqual([])
  })

  it('appears in the queue with its fields, folded into one record', async () => {
    const queue = await submissions.pending()
    const mine = queue.find(item => item.plugin === result.plugin)
    expect(mine).toBeTruthy()
    expect(mine.fields.name).toBe(FIELDS.name)
    // Several formats come back as several, not as whichever was written last.
    expect(mine.fields.format.sort()).toEqual(['LV2', 'VST3'])
    // One record, not one per proposed field — it is reviewed whole.
    expect(queue.filter(item => item.plugin === result.plugin)).toHaveLength(1)
  })

  it('refuses a second proposal of the same plugin while the first waits', async () => {
    await expect(submissions.submit({ account: contributor, fields: FIELDS }, tick()))
      .rejects.toThrow(/already proposed/)
  })

  it('becomes catalogue data in the contributor\'s CC0 graph when accepted', async () => {
    const outcome = await submissions.review({
      submissionIri: result.iri, moderator, accept: true, accounts
    }, tick())
    expect(outcome.status).toBe(STATUS.ACCEPTED)

    const written = await anywhere(result.plugin)
    expect(written.length).toBeGreaterThan(4)
    const graphs = new Set(written.map(row => row.g))
    expect(graphs.size, 'the plugin was written into more than one graph').toBe(1)

    const base = contributor.iri.split('/').pop()
    expect([...graphs][0]).toBe(GraphRegistry.graphIri('user', `${base}-facts`))

    const predicates = written.map(row => row.p)
    expect(predicates).toContain(`${NAMESPACES.rdfs}label`)
    expect(predicates).toContain(`${NAMESPACES.dcterms}created`)

    // Both formats, as two statements. A plugin built for VST3 and LV2 that
    // arrived in the catalogue as one of them would be wrong in a way nothing
    // downstream could detect.
    const formats = written.filter(row => row.p === `${NAMESPACES.trn}format`).map(row => row.o)
    expect(formats.sort()).toEqual([`${NAMESPACES.trn}LV2`, `${NAMESPACES.trn}VST3`])
  })

  it('refuses a proposal of a plugin the catalogue now holds', async () => {
    await expect(submissions.submit({ account: contributor, fields: FIELDS }, tick()))
      .rejects.toThrow(/already has this plugin/)
  })

  it('names the plugin it duplicated, so the person can be sent to it', async () => {
    const error = await submissions.submit({ account: contributor, fields: FIELDS }, tick())
      .catch(e => e)
    expect(error).toBeInstanceOf(SubmissionError)
    expect(error.existing).toBe(result.plugin)
  })
})

describe('a rejected submission', () => {
  it('writes nothing anywhere', async () => {
    const other = { ...FIELDS, name: 'Rejected Plugin', homepage: 'https://example.invalid/rejected' }
    const proposed = await submissions.submit({ account: contributor, fields: other }, tick())

    const outcome = await submissions.review({
      submissionIri: proposed.iri, moderator, accept: false, accounts
    }, tick())
    expect(outcome.status).toBe(STATUS.REJECTED)

    // Nothing to undo: it was never in the catalogue. That is the advantage of
    // holding the fields on the submission rather than writing them
    // provisionally and deleting them on rejection.
    expect(await anywhere(proposed.plugin)).toEqual([])
  })

  it('cannot be reviewed twice', async () => {
    const other = { ...FIELDS, name: 'Twice Plugin', homepage: 'https://example.invalid/twice' }
    const proposed = await submissions.submit({ account: contributor, fields: other }, tick())
    await submissions.review({ submissionIri: proposed.iri, moderator, accept: false, accounts }, tick())
    await expect(submissions.review({ submissionIri: proposed.iri, moderator, accept: true, accounts }, tick()))
      .rejects.toThrow(/not pending/)
  })
})

describe('who may do what', () => {
  it('lets nobody but a moderator review', async () => {
    const other = { ...FIELDS, name: 'Guarded Plugin', homepage: 'https://example.invalid/guarded' }
    const proposed = await submissions.submit({ account: contributor, fields: other }, tick())
    await expect(submissions.review({
      submissionIri: proposed.iri, moderator: contributor, accept: true, accounts
    }, tick())).rejects.toThrow(/Only a moderator/)
  })

  it('publishes a trusted contributor\'s submission on arrival', async () => {
    const trusted = await accounts.upsert({ githubId: '991003', login: 'test-trusted', name: 'Trusted' })
    await accounts.setTrust(trusted.iri, TRUST.TRUSTED)
    const account = await accounts.find(trusted.iri)

    const other = { ...FIELDS, name: 'Trusted Plugin', homepage: 'https://example.invalid/trusted' }
    const proposed = await submissions.submit({ account, fields: other }, tick())
    expect(proposed.status).toBe(STATUS.ACCEPTED)
    expect((await anywhere(proposed.plugin)).length).toBeGreaterThan(4)

    const base = account.iri.split('/').pop()
    for (const suffix of ['facts', 'prose']) {
      await client.update(`DROP SILENT GRAPH ${iri(GraphRegistry.graphIri('user', `${base}-${suffix}`))}`)
    }
  })
})
