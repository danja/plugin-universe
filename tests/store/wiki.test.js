import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import Accounts from '../../src/auth/Accounts.js'
import Wiki, { WikiError, WikiConflictError } from '../../src/wiki/Wiki.js'
import ShapeValidator, { summarise } from '../../src/store/ShapeValidator.js'
import { iri } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * Wiki prose, against the live store.
 *
 * The reason this suite exists rather than a mocked one: the prose is a
 * stranger's free text going into a SPARQL literal, and whether that survives
 * the round trip is a property of the store and the escaping together. A fake
 * client would accept anything and prove nothing.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const registry = new GraphRegistry(client, { metadataGraph: `${NAMESPACES.pu}test/wiki-graphs` })
const accounts = new Accounts(client, { registry, graphId: 'test-wiki-accounts' })
const wiki = new Wiki(client, { registry })
const PLUGIN = `${NAMESPACES.pu}plugin/test-wiki-subject`
const AUTHOR = { githubId: '990101', login: 'test-wiki-author', name: 'An Author' }
const OTHER = { githubId: '990102', login: 'test-wiki-other', name: 'Another' }

let author
let other
let validator
let clock = Date.now()
const tick = () => new Date(clock += 1000)

async function cleanup () {
  await client.update(`DROP SILENT GRAPH ${iri(accounts.graph)}`)
  await client.update(`DROP SILENT GRAPH ${iri(`${NAMESPACES.pu}test/wiki-graphs`)}`)
  for (const identity of [AUTHOR, OTHER]) {
    const base = accounts.accountIri(identity.githubId).split('/').pop()
    for (const suffix of ['facts', 'prose']) {
      await client.update(`DROP SILENT GRAPH ${iri(GraphRegistry.graphIri('user', `${base}-${suffix}`))}`)
    }
  }
}

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  await cleanup()
  await accounts.ensureGraph()
  author = await accounts.upsert(AUTHOR)
  other = await accounts.upsert(OTHER)
  validator = await ShapeValidator.load()
}, 60000)

afterAll(cleanup)

describe('a page begins', () => {
  it('has nothing before anybody writes', async () => {
    expect(await wiki.current(PLUGIN)).toBeNull()
  })

  it('saves a first revision into the author\'s prose graph', async () => {
    const saved = await wiki.save({
      account: author, pluginIri: PLUGIN, text: '# About\n\nA useful plugin.', summary: 'first'
    }, tick())
    // CC BY-SA, not CC0: prose is licensed differently from facts and the
    // graph is where that is decided.
    expect(saved.graph).toContain('-prose')
    const rows = await registry.list()
    expect(rows.find(row => row.graph === saved.graph).licence).toBe('CC-BY-SA-4.0')
  }, 30000)

  it('reads back as the current revision', async () => {
    const current = await wiki.current(PLUGIN)
    expect(current.text).toContain('A useful plugin.')
    expect(current.author).toBe(author.iri)
  })

  it('conforms to the shapes', async () => {
    const graph = GraphRegistry.graphIri('user', `${author.iri.split('/').pop()}-prose`)
    expect(summarise(await validator.validateGraph(client, graph))).toBe('conforms')
  }, 60000)
})

describe('a stranger\'s text survives becoming a SPARQL literal', () => {
  // The specific worry: prose goes into a literal, and a quote, a backslash or
  // a newline in somebody's sentence must not end the literal or the update.
  const HOSTILE = [
    'A "quoted" phrase.',
    'A backslash \\ and a double one \\\\.',
    'Three quotes: """ and a lone \' apostrophe.',
    'A newline\nand a tab\tand a carriage return\r.',
    'SPARQL-shaped: " } INSERT DATA { GRAPH <urn:evil> { <urn:a> <urn:b> <urn:c> } } #',
    'Unicode: café — 日本語 — 🎛️',
    'Angle brackets <not html> & an ampersand'
  ].join('\n\n')

  it('round-trips every one of them unchanged', async () => {
    const previous = (await wiki.current(PLUGIN)).revision
    await wiki.save({
      account: author, pluginIri: PLUGIN, text: HOSTILE, summary: 'hostile text', previous
    }, tick())
    const current = await wiki.current(PLUGIN)
    // Carriage returns are normalised on the way in; nothing else is touched.
    expect(current.text).toBe(HOSTILE.replace(/\r\n/g, '\n').replace(/\r/g, '\r'))
  }, 30000)

  it('wrote nothing into the graph the injection attempt named', async () => {
    // If escaping failed, the payload above would have created this graph.
    const escaped = await client.ask('ASK { GRAPH <urn:evil> { ?s ?p ?o } }')
    expect(escaped, 'a literal escaped its quotes and ran as an update').toBe(false)
  })

  it('still conforms to the shapes afterwards', async () => {
    const graph = GraphRegistry.graphIri('user', `${author.iri.split('/').pop()}-prose`)
    expect(summarise(await validator.validateGraph(client, graph))).toBe('conforms')
  }, 60000)
})

describe('revisions supersede rather than replace', () => {
  it('keeps every version, newest first', async () => {
    const history = await wiki.history(PLUGIN)
    expect(history.length).toBe(2)
    expect(new Date(history[0].at).getTime()).toBeGreaterThan(new Date(history[1].at).getTime())
  })

  it('links each revision to the one it replaced', async () => {
    const current = await wiki.current(PLUGIN)
    expect(current.previous).toBeTruthy()
    const older = await wiki.revision(current.previous)
    expect(older.text).toContain('A useful plugin.')
  })

  it('lets an old revision still be read', async () => {
    // Reverting is writing an old body again, which is only possible if the
    // old body is still there.
    const history = await wiki.history(PLUGIN)
    const oldest = await wiki.revision(history[history.length - 1].revision)
    expect(oldest.text).toContain('# About')
  })
})

describe('two people editing at once', () => {
  it('refuses a save built on a revision that is no longer current', async () => {
    // The one thing a wiki must not do is silently overwrite somebody's work.
    const stale = (await wiki.history(PLUGIN)).at(-1).revision
    await expect(wiki.save({
      account: other, pluginIri: PLUGIN, text: 'Rewritten from an old copy.', previous: stale
    }, tick())).rejects.toThrow(WikiConflictError)
  })

  it('hands the current revision back so the editor can merge', async () => {
    const stale = (await wiki.history(PLUGIN)).at(-1).revision
    const error = await wiki.save({
      account: other, pluginIri: PLUGIN, text: 'x', previous: stale
    }, tick()).catch(caught => caught)
    expect(error.current.text).toBeTruthy()
  })

  it('refuses a first-edit save when the page already exists', async () => {
    await expect(wiki.save({
      account: other, pluginIri: PLUGIN, text: 'Starting fresh.', previous: null
    }, tick())).rejects.toThrow(WikiConflictError)
  })

  it('accepts a second author writing on top of the current revision', async () => {
    // Each author's revisions live in their own graph; the page is the union.
    const previous = (await wiki.current(PLUGIN)).revision
    const saved = await wiki.save({
      account: other, pluginIri: PLUGIN, text: 'Now with a second author.', previous
    }, tick())
    expect(saved.graph).toContain(other.iri.split('/').pop())
    const current = await wiki.current(PLUGIN)
    expect(current.author).toBe(other.iri)
    expect(current.text).toBe('Now with a second author.')
  }, 30000)
})

describe('what is refused', () => {
  it('refuses an empty body', async () => {
    const previous = (await wiki.current(PLUGIN)).revision
    await expect(wiki.save({ account: author, pluginIri: PLUGIN, text: '   ', previous }, tick()))
      .rejects.toThrow(WikiError)
  })

  it('refuses a save that changes nothing', async () => {
    const current = await wiki.current(PLUGIN)
    await expect(wiki.save({
      account: author, pluginIri: PLUGIN, text: current.text, previous: current.revision
    }, tick())).rejects.toThrow(/Nothing changed/)
  })

  it('refuses text past the length limit', async () => {
    const previous = (await wiki.current(PLUGIN)).revision
    await expect(wiki.save({
      account: author,
      pluginIri: PLUGIN,
      text: 'x'.repeat(CONTRIBUTION_CONFIG.maxWikiLength + 1),
      previous
    }, tick())).rejects.toThrow(/limit is/)
  })

  it('refuses a subject that is not a plugin in this catalogue', async () => {
    await expect(wiki.save({
      account: author, pluginIri: 'https://evil.invalid/thing', text: 'hello'
    }, tick())).rejects.toThrow(WikiError)
  })

  it('refuses a suspended account', async () => {
    await expect(wiki.save({
      account: { ...author, suspended: true }, pluginIri: PLUGIN, text: 'hello'
    }, tick())).rejects.toThrow(/suspended/)
  })
})
