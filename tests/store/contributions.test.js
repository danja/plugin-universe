import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import Accounts, { TRUST } from '../../src/auth/Accounts.js'
import Corrections, { CorrectionError, STATUS } from '../../src/contrib/Corrections.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * The moderation loop, against the live store.
 *
 * Everything here writes: a correction is a SPARQL update, a trust level is a
 * delete-and-insert, and the whole point of the design is which graph a triple
 * lands in. None of that is observable through a mock, so per project policy it
 * runs against the endpoint in config/config.json.
 *
 * The graph ids are parameters rather than the live ones. Accounts and pending
 * corrections are personal data, and a suite that writes into the graph holding
 * real people's contributions to assert something about a fake one is a bad
 * trade whatever the cleanup does afterwards.
 */

const pu = NAMESPACES.pu
const prov = NAMESPACES.prov
const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

const registry = new GraphRegistry(client, { metadataGraph: `${pu}test/contribution-graphs` })
const accounts = new Accounts(client, { registry, graphId: 'test-accounts' })
const corrections = new Corrections(client, { registry, graphId: 'test-corrections' })

const CONTRIBUTOR = { githubId: '990001', login: 'test-contributor', name: 'A Contributor' }
const MODERATOR = { githubId: '990002', login: 'test-moderator', name: 'A Moderator' }
const SUBJECT = `${pu}plugin/test-contribution-subject`

/** A distinct instant per submission: the correction IRI is minted over it. */
let clock = Date.now()
const tick = () => new Date(clock += 1000)

async function cleanup () {
  for (const graph of [accounts.graph, corrections.queueGraph, `${pu}test/contribution-graphs`]) {
    await client.update(`DROP SILENT GRAPH ${iri(graph)}`)
  }
  for (const identity of [CONTRIBUTOR, MODERATOR]) {
    const base = accounts.accountIri(identity.githubId).split('/').pop()
    for (const suffix of ['facts', 'prose']) {
      await client.update(`DROP SILENT GRAPH ${iri(GraphRegistry.graphIri('user', `${base}-${suffix}`))}`)
    }
  }
}

/** What actually reached the contributor's CC0 graph. */
async function factsOf (account) {
  const base = account.iri.split('/').pop()
  return client.select(`
    SELECT ?p ?o WHERE {
      GRAPH ${iri(GraphRegistry.graphIri('user', `${base}-facts`))} { ${iri(SUBJECT)} ?p ?o }
    }`)
}

let contributor
let moderator

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  await cleanup()
  await accounts.ensureGraph()
  await corrections.ensureGraph()
  contributor = await accounts.upsert(CONTRIBUTOR)
  const promoted = await accounts.upsert(MODERATOR)
  await accounts.setTrust(promoted.iri, TRUST.MODERATOR)
  moderator = await accounts.find(promoted.iri)
})

afterAll(cleanup)

describe('a new contributor is queued, not applied', () => {
  it('queues the correction and writes nothing public', async () => {
    const outcome = await corrections.submit({
      account: contributor,
      subject: SUBJECT,
      predicate: `${NAMESPACES.rdfs}comment`,
      value: 'Queued, because this account has earned nothing yet.'
    }, tick())
    expect(outcome.status).toBe(STATUS.PENDING)
    expect(await factsOf(contributor)).toEqual([])
    expect((await corrections.pending()).map(row => row.correction)).toContain(outcome.iri)
  })
})

describe('review', () => {
  it('refuses anyone who is not a moderator', async () => {
    const queued = (await corrections.pending())[0]
    await expect(corrections.review({
      correctionIri: queued.correction, moderator: contributor, accept: true, accounts
    })).rejects.toThrow(CorrectionError)
  })

  it('accepting writes the fact into the contributor graph, not over the harvested one', async () => {
    const queued = (await corrections.pending())[0]
    const outcome = await corrections.review({
      correctionIri: queued.correction, moderator, accept: true, accounts
    }, tick())
    expect(outcome.status).toBe(STATUS.ACCEPTED)

    const facts = await factsOf(contributor)
    expect(facts).toHaveLength(1)
    expect(facts[0].p).toBe(`${NAMESPACES.rdfs}comment`)
  })

  it('records who decided it', async () => {
    const rows = await client.select(`
      SELECT ?by WHERE {
        GRAPH ${iri(corrections.queueGraph)} { ?c ${iri(pu + 'reviewedBy')} ?by }
      }`)
    expect(rows.map(row => row.by)).toContain(moderator.iri)
  })

  it('refuses a correction that has already been decided', async () => {
    const rows = await client.select(`
      SELECT ?c WHERE {
        GRAPH ${iri(corrections.queueGraph)} {
          ?c ${iri(pu + 'correctionStatus')} ${literal(STATUS.ACCEPTED)}
        }
      } LIMIT 1`)
    await expect(corrections.review({
      correctionIri: rows[0].c, moderator, accept: true, accounts
    })).rejects.toThrow(/not pending/)
  })

  it('rejecting writes nothing to a public graph but keeps the record', async () => {
    const before = (await factsOf(contributor)).length
    const submitted = await corrections.submit({
      account: contributor,
      subject: SUBJECT,
      predicate: `${pu}category`,
      value: 'reverb',
      rationale: 'A reason that will be declined.'
    }, tick())

    const outcome = await corrections.review({
      correctionIri: submitted.iri, moderator, accept: false, accounts
    }, tick())
    expect(outcome.status).toBe(STATUS.REJECTED)
    expect(await factsOf(contributor)).toHaveLength(before)

    // The record survives the decision: a queue that forgets its rejections
    // invites the same suggestion every week.
    const kept = await client.ask(`
      ASK { GRAPH ${iri(corrections.queueGraph)} {
        ${iri(submitted.iri)} ${iri(pu + 'correctionStatus')} ${literal(STATUS.REJECTED)}
      } }`)
    expect(kept).toBe(true)
  })
})

describe('trust is earned, and then the queue shrinks', () => {
  it('promotes a contributor at the threshold and not before', async () => {
    let promoted = false
    let accepted = await corrections.acceptedCount(contributor.iri)

    // One short of the threshold, submitting and accepting each in turn. The
    // account must still be `new` on the way there — a promotion that fires
    // early would mean unreviewed writes into a public graph.
    while (accepted < CONTRIBUTION_CONFIG.acceptedBeforeTrusted) {
      const current = await accounts.find(contributor.iri)
      expect(current.trustLevel).toBe(TRUST.NEW)

      const submitted = await corrections.submit({
        account: current,
        subject: SUBJECT,
        predicate: `${NAMESPACES.trn}vendor`,
        value: `Vendor ${accepted}`
      }, tick())
      expect(submitted.status).toBe(STATUS.PENDING)

      const outcome = await corrections.review({
        correctionIri: submitted.iri, moderator, accept: true, accounts
      }, tick())
      promoted = outcome.promoted
      accepted = await corrections.acceptedCount(contributor.iri)
    }

    expect(promoted).toBe(true)
    expect((await accounts.find(contributor.iri)).trustLevel).toBe(TRUST.TRUSTED)
  })

  it('applies a trusted contributor\'s correction on arrival', async () => {
    const trusted = await accounts.find(contributor.iri)
    const outcome = await corrections.submit({
      account: trusted,
      subject: SUBJECT,
      predicate: `${NAMESPACES.foaf}homepage`,
      value: 'https://example.invalid/plugin'
    }, tick())
    expect(outcome.status).toBe(STATUS.ACCEPTED)

    const facts = await factsOf(trusted)
    expect(facts.some(row => row.o === 'https://example.invalid/plugin')).toBe(true)
  })

  it('does not promote someone who is already a moderator', async () => {
    // `promoteIfEarned` sets `trusted`, which is a demotion for a moderator.
    expect(await accounts.promoteIfEarned(moderator, 1000)).toBe(false)
    expect((await accounts.find(moderator.iri)).trustLevel).toBe(TRUST.MODERATOR)
  })
})

describe('the rate limit is counted from the store', () => {
  it('counts only the last hour', async () => {
    const stale = `${pu}correction/test-stale`
    await client.update(insertDataQuery(corrections.queueGraph, [
      `${iri(stale)} ${iri(prov + 'wasAttributedTo')} ${iri(contributor.iri)} .`,
      `${iri(stale)} ${iri(prov + 'generatedAtTime')} ` +
        `${typedLiteral(new Date(Date.now() - 3 * 60 * 60 * 1000))} .`
    ]))
    const recent = await corrections.recentCount(contributor.iri)
    const all = await client.select(`
      SELECT (COUNT(*) AS ?n) WHERE {
        GRAPH ${iri(corrections.queueGraph)} {
          ?c ${iri(prov + 'wasAttributedTo')} ${iri(contributor.iri)} ;
             ${iri(prov + 'generatedAtTime')} ?at .
        }
      }`)
    expect(recent).toBeLessThan(Number(all[0].n))
  })

  it('refuses the submission past the hourly limit', async () => {
    // Filled directly rather than by submitting: what is under test is that the
    // limit is enforced from what the store holds, and it has to survive a
    // restart, which is why it is counted there rather than kept in memory.
    const now = Date.now()
    const filler = []
    for (let i = 0; i < CONTRIBUTION_CONFIG.perAccountPerHour; i++) {
      const node = `${pu}correction/test-filler-${i}`
      filler.push(
        `${iri(node)} ${iri(prov + 'wasAttributedTo')} ${iri(contributor.iri)} .`,
        `${iri(node)} ${iri(prov + 'generatedAtTime')} ${typedLiteral(new Date(now - i * 1000))} .`
      )
    }
    await client.update(insertDataQuery(corrections.queueGraph, filler))

    await expect(corrections.submit({
      account: await accounts.find(contributor.iri),
      subject: SUBJECT,
      predicate: `${NAMESPACES.rdfs}label`,
      value: 'One too many'
    }, tick())).rejects.toThrow(/limit/)
  })
})
