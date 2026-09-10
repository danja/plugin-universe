import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import DumpBuilder from '../../src/store/DumpBuilder.js'
import Publication, { PublicationError, NEVER_PUBLISH } from '../../src/store/Publication.js'

/**
 * Publishing to the public SPARQL dataset.
 *
 * The public endpoint serves a **separate dataset**, not a read-only view of
 * the catalogue, because a SPARQL endpoint exposes every named graph it holds
 * whatever the default graph is set to. `GRAPH <graph:system/accounts>` would
 * return a person's name and avatar from any endpoint pointed at the live
 * store, so the way to not publish accounts is to not put them there.
 *
 * The publication dataset does not exist on a development machine, so what is
 * tested here is the half that can go catastrophically wrong locally: the
 * guard against writing to the **wrong** dataset. The rest is asserted against
 * the deployed endpoint by the live suite, which is where it matters.
 */

const config = Config.load()
const catalogue = new SPARQLClient(config.get('storage.endpoint'))

let dumpDir

beforeAll(async () => {
  if (!(await catalogue.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  dumpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-publish-'))
  await new DumpBuilder(catalogue, { outputDir: dumpDir }).build()
}, 120000)

describe('refusing the wrong target', () => {
  it('will not publish into the catalogue', async () => {
    // The failure this exists for: `storage.publication` pointed at the live
    // dataset by a typo or a copied config. Publishing drops every graph not
    // in the dump, so it would delete accounts and pending corrections and the
    // first anybody would know is that they were gone.
    const wrong = new Publication(catalogue, { dumpDir })
    await expect(wrong.publish()).rejects.toThrow(/catalogue and not the publication/)
  }, 60000)

  it('leaves the catalogue untouched when it refuses', async () => {
    const graphs = await new Publication(catalogue, { dumpDir }).published()
    expect(graphs).toContain('graph:system/accounts')
    expect(graphs).toContain('graph:system/corrections')
  })

  it('will not publish without a dump to publish', async () => {
    const empty = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-nodump-'))
    try {
      await expect(new Publication(catalogue, { dumpDir: empty }).manifest())
        .rejects.toThrow(/Run bin\/dump\.js first/)
    } finally {
      await fs.promises.rm(empty, { recursive: true, force: true })
    }
  })
})

describe('what may never be published', () => {
  it('names the graph families rather than inferring them', () => {
    // Stated as names beside the dump's own selection by licence flag. If the
    // two ever disagree, the publish fails rather than resolving it in favour
    // of shipping.
    expect(NEVER_PUBLISH).toContain('graph:system/')
  })

  it('refuses a dump that contains one of them, before writing anything', async () => {
    const tampered = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-tampered-'))
    try {
      await new DumpBuilder(catalogue, { outputDir: tampered }).build()
      const file = path.join(tampered, 'MANIFEST.json')
      const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'))
      manifest.parts.cc0.graphs.push({
        graph: 'graph:system/accounts', licence: 'CC0-1.0', file: 'cc0/nonsense.ttl', triples: 1
      })
      await fs.promises.writeFile(file, JSON.stringify(manifest))
      // Checked before the first write, not after — a publish that discovers
      // this halfway through has already published it.
      await expect(new Publication(catalogue, { dumpDir: tampered }).publish())
        .rejects.toThrow(/must never be published/)
    } finally {
      await fs.promises.rm(tampered, { recursive: true, force: true })
    }
  }, 120000)
})

describe('auditing what is actually served', () => {
  it('asks the endpoint rather than trusting what was intended', async () => {
    // Pointed at the catalogue, the audit should find exactly the graphs that
    // must not be public — which is the check working, not failing.
    const audit = await new Publication(catalogue, { dumpDir }).audit()
    expect(audit).toContain('graph:system/accounts')
  })
})

describe('the description', () => {
  it('states the default graph answer rather than leaving it to be discovered', () => {
    const description = new Publication(catalogue, { dumpDir })
      .describe({ publishedAt: '2026-09-10T00:00:00.000Z', triples: 42 })
    expect(description).toMatch(/union of every named graph/)
    expect(description).toContain('void:sparqlEndpoint')
    expect(description).toContain('void:triples 42')
  })

  it('says it is a published copy, not the live catalogue', () => {
    const description = new Publication(catalogue, { dumpDir })
      .describe({ publishedAt: '2026-09-10T00:00:00.000Z', triples: 42 })
    expect(description).toMatch(/published copy, not the live catalogue/)
  })
})
