import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import Feedback, { FeedbackError } from '../../src/contrib/Feedback.js'
import ShapeValidator from '../../src/store/ShapeValidator.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * A message, written and read back.
 *
 * The write path is the half that has been broken before — image upload had 22
 * passing tests covering bytes, types and refusals, and none covering the
 * triple it was supposed to write, which is the half that did not work. So
 * every assertion here goes through the store.
 *
 * The one that matters most is the licence flag. A message is correspondence,
 * not a contribution, and if its graph is ever registered as CC0 or CC BY-SA
 * then the next dump publishes private mail. Nothing else in the system would
 * notice: the dump query asks the graph, and the graph would have said yes.
 */

const GRAPH_ID = 'feedback-test'
const ACCOUNT = {
  iri: `${NAMESPACES.pu}person/feedback-tester-00000000`,
  login: 'feedback-tester',
  trustLevel: 'new',
  suspended: false
}

let client
let feedback
let registry

beforeAll(async () => {
  const config = await Config.load()
  client = new SPARQLClient(config.get('storage.endpoint'))
  registry = new GraphRegistry(client)
  feedback = new Feedback(client, { graphId: GRAPH_ID, registry })
  await client.update(`DROP SILENT GRAPH <${GraphRegistry.graphIri('system', GRAPH_ID)}>`)
  await feedback.ensureGraph()
})

afterAll(async () => {
  await client.update(`DROP SILENT GRAPH <${GraphRegistry.graphIri('system', GRAPH_ID)}>`)
})

describe('a message survives the round trip', () => {
  it('is written, and comes back out of the queue', async () => {
    const sent = await feedback.submit({ account: ACCOUNT, message: 'The category page confused me.' })
    expect(sent.status).toBe('new')
    expect(sent.iri).toContain('/feedback/')

    const pending = await feedback.pending()
    const mine = pending.find(row => row.iri === sent.iri)
    expect(mine, 'the message was written and the queue cannot see it').toBeTruthy()
    expect(mine.message).toBe('The category page confused me.')
    expect(mine.by).toBe(ACCOUNT.iri)
    expect(mine.at).toBeTruthy()
  })

  it('leaves the queue once a moderator marks it read', async () => {
    const sent = await feedback.submit({ account: ACCOUNT, message: 'A second one.' })
    expect((await feedback.pending()).some(row => row.iri === sent.iri)).toBe(true)

    await feedback.markRead({ feedbackIri: sent.iri, moderator: { iri: `${NAMESPACES.pu}person/mod-00000000` } })
    expect((await feedback.pending()).some(row => row.iri === sent.iri)).toBe(false)
  })

  it('keeps the message after it is read, attributed and dated', async () => {
    // Marking read is not deleting. A moderator needs to be able to look at
    // what somebody said last month, and erasure is a DROP of the graph rather
    // than a side effect of the queue.
    const rows = await client.select(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${GraphRegistry.graphIri('system', GRAPH_ID)}> { ` +
      `?f <${NAMESPACES.pu}feedbackStatus> "read" ; <${NAMESPACES.prov}wasAttributedTo> ?by ; ` +
      `<${NAMESPACES.prov}generatedAtTime> ?at } }`)
    expect(Number(rows[0].n)).toBeGreaterThan(0)
  })
})

describe('the graph it lands in', () => {
  it('is registered as personal data, so no dump can carry it', async () => {
    const graph = GraphRegistry.graphIri('system', GRAPH_ID)
    const registered = (await registry.list()).find(row => row.graph === graph)
    expect(registered, 'the graph is not in the registry at all').toBeTruthy()
    expect(registered.licence).toBe('personal-data')
    const { LICENCES } = await import('../../src/store/GraphRegistry.js')
    expect(LICENCES[registered.licence].redistributable).toBe(false)
  })

  it('is not among the graphs a CC0 dump draws on', () => {
    // The assertion that matters, made against the query the dump actually
    // runs rather than against the flag it reads.
    return registry.cc0DumpGraphs().then(graphs => {
      expect(graphs).not.toContain(GraphRegistry.graphIri('system', GRAPH_ID))
    })
  })

  it('is not one of the contributor graphs', async () => {
    // Those two are the published ones. A message in either would be CC0 or
    // CC BY-SA, which nobody agreed to when they wrote in.
    const graph = GraphRegistry.graphIri('system', GRAPH_ID)
    expect(graph).toContain('graph:system')
    expect(graph).not.toContain('graph:user')
  })
})

describe('what it refuses', () => {
  it('refuses an unsigned-in sender', async () => {
    await expect(feedback.submit({ account: null, message: 'hello' })).rejects.toThrow(FeedbackError)
  })

  it('refuses a suspended account', async () => {
    await expect(feedback.submit({ account: { ...ACCOUNT, suspended: true }, message: 'hello' }))
      .rejects.toThrow(/suspended/)
  })

  it('refuses an empty message before writing anything', async () => {
    const before = (await feedback.pending()).length
    await expect(feedback.submit({ account: ACCOUNT, message: '  ' })).rejects.toThrow(FeedbackError)
    expect((await feedback.pending()).length).toBe(before)
  })

  it('rate limits, counting from the store rather than from memory', async () => {
    // Counted in the store so it survives a restart and cannot be reset by
    // making the app forget. The limit is deliberately low: a message is a
    // demand on somebody's attention.
    const account = { ...ACCOUNT, iri: `${NAMESPACES.pu}person/flooder-00000000` }
    for (let i = 0; i < CONTRIBUTION_CONFIG.feedbackPerHour; i++) {
      await feedback.submit({ account, message: `message ${i}` })
    }
    await expect(feedback.submit({ account, message: 'one too many' }))
      .rejects.toThrow(/which is the limit/)

    const fresh = new Feedback(client, { graphId: GRAPH_ID, registry })
    expect(await fresh.recentCount(account.iri)).toBeGreaterThanOrEqual(CONTRIBUTION_CONFIG.feedbackPerHour)
  })
})

describe('the shapes', () => {
  const pu = NAMESPACES.pu
  const prov = NAMESPACES.prov
  const when = '"2026-09-13T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>'

  it('accept a well-formed message', async () => {
    const validator = await ShapeValidator.load()
    const report = await validator.validateTriples([
      `<urn:f1> <${NAMESPACES.rdf}type> <${pu}Feedback> .`,
      `<urn:f1> <${pu}message> "Something useful." .`,
      `<urn:f1> <${pu}feedbackStatus> "new" .`,
      `<urn:f1> <${prov}wasAttributedTo> <urn:someone> .`,
      `<urn:f1> <${prov}generatedAtTime> ${when} .`
    ])
    expect(report.conforms).toBe(true)
  })

  it('refuse one with no author', async () => {
    // Only a signed-in account may write, so an unattributed message is one the
    // route should never have produced — and one nobody could reply to.
    const validator = await ShapeValidator.load()
    const report = await validator.validateTriples([
      `<urn:f2> <${NAMESPACES.rdf}type> <${pu}Feedback> .`,
      `<urn:f2> <${pu}message> "No author." .`,
      `<urn:f2> <${pu}feedbackStatus> "new" .`,
      `<urn:f2> <${prov}generatedAtTime> ${when} .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('refuse a status that belongs to a correction', async () => {
    // "accepted" is a correction's word. A message is new or read.
    const validator = await ShapeValidator.load()
    const report = await validator.validateTriples([
      `<urn:f3> <${NAMESPACES.rdf}type> <${pu}Feedback> .`,
      `<urn:f3> <${pu}message> "x" .`,
      `<urn:f3> <${pu}feedbackStatus> "accepted" .`,
      `<urn:f3> <${prov}wasAttributedTo> <urn:someone> .`,
      `<urn:f3> <${prov}generatedAtTime> ${when} .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('refuse an empty message', async () => {
    const validator = await ShapeValidator.load()
    const report = await validator.validateTriples([
      `<urn:f4> <${NAMESPACES.rdf}type> <${pu}Feedback> .`,
      `<urn:f4> <${pu}message> "" .`,
      `<urn:f4> <${pu}feedbackStatus> "new" .`,
      `<urn:f4> <${prov}wasAttributedTo> <urn:someone> .`,
      `<urn:f4> <${prov}generatedAtTime> ${when} .`
    ])
    expect(report.conforms).toBe(false)
  })
})
