import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import BackupBuilder, { BackupError, isIrreplaceable } from '../../src/store/BackupBuilder.js'
import { iri, literal, insertDataQuery } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * Backing the store up and putting it back.
 *
 * The only assertion here that is worth anything is the round trip: back a
 * graph up, destroy it, restore it, and find it identical. An untested backup
 * is a belief, and the moment anybody needs it is the worst moment to discover
 * which of the two it was.
 *
 * The round trip runs against a graph created for the purpose, not against real
 * data — a test that proves restore works by first dropping the accounts graph
 * would be a poor trade.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const backups = new BackupBuilder(client)
const SCRATCH = 'graph:system/test-backup-scratch'
const subject = `${NAMESPACES.pu}plugin/test-backup`

let directory

async function seed () {
  await client.update(`DROP SILENT GRAPH ${iri(SCRATCH)}`)
  await client.update(insertDataQuery(SCRATCH, [
    `${iri(subject)} ${iri(NAMESPACES.rdfs + 'label')} ${literal('Backup Subject')} .`,
    `${iri(subject)} ${iri(NAMESPACES.rdfs + 'comment')} ${literal('A "quoted" line,\nand a second.')} .`,
    // A blank node, because splitting one across two INSERT DATA requests is
    // the defect this project has already shipped once.
    `${iri(subject)} ${iri(NAMESPACES.lv2 + 'port')} _:p1 .`,
    `_:p1 ${iri(NAMESPACES.lv2 + 'symbol')} ${literal('gain')} .`,
    `_:p1 ${iri(NAMESPACES.lv2 + 'name')} ${literal('Gain')} .`
  ]))

  // And enough blank nodes to cross a write batch, which is the only size at
  // which the defect appears. The version of this test that used three triples
  // passed while a real restore was cutting 114 of 594 ports in half: the
  // triple count came back correct and only SHACL noticed. A test that proves
  // a mechanism on a toy has proved it on a toy.
  const many = []
  for (let i = 0; i < 400; i++) {
    many.push(
      `${iri(subject)} ${iri(NAMESPACES.lv2 + 'port')} _:big${i} .`,
      `_:big${i} ${iri(NAMESPACES.lv2 + 'symbol')} ${literal(`p${i}`)} .`,
      `_:big${i} ${iri(NAMESPACES.lv2 + 'name')} ${literal(`Port ${i}`)} .`)
  }
  await client.update(insertDataQuery(SCRATCH, many))
}

const count = async graph => Number((await client.select(
  `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${iri(graph)} { ?s ?p ?o } }`))[0].n)

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  await seed()
  directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-backup-'))
}, 60000)

afterAll(async () => {
  await client.update(`DROP SILENT GRAPH ${iri(SCRATCH)}`)
  if (directory) await fs.promises.rm(directory, { recursive: true, force: true })
})

describe('what counts as irreplaceable', () => {
  it('is the contributions and the accounts, which no harvester can rebuild', () => {
    expect(isIrreplaceable('graph:system/accounts')).toBe(true)
    expect(isIrreplaceable('graph:user/someone-prose')).toBe(true)
  })

  it('includes the graph registry, without which a restore has data and no index', () => {
    expect(isIrreplaceable(`${NAMESPACES.pu}graphs`)).toBe(true)
  })

  it('excludes anything a harvester can produce again', () => {
    expect(isIrreplaceable('graph:source/open-audio-stack')).toBe(false)
    expect(isIrreplaceable('graph:alignment/categories')).toBe(false)
    expect(isIrreplaceable('graph:profiler/lv2-scan-1')).toBe(false)
  })
})

describe('taking a backup', () => {
  it('asks the store what graphs exist rather than the registry', async () => {
    // A graph that failed to register still holds data. A backup that trusted
    // an index would omit whatever the index had forgotten.
    expect(await backups.graphs()).toContain(SCRATCH)
  })

  it('writes every graph with a manifest', async () => {
    const manifest = await backups.backup({ outputDir: directory, scope: 'full' })
    expect(manifest.graphs.length).toBeGreaterThan(3)
    for (const graph of manifest.graphs) {
      expect(fs.existsSync(path.join(directory, graph.file)), graph.file).toBe(true)
    }
  }, 120000)

  it('says what an essential backup left out', async () => {
    const essential = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-essential-'))
    try {
      const manifest = await backups.backup({ outputDir: essential, scope: 'essential' })
      expect(manifest.graphs.every(graph => isIrreplaceable(graph.graph))).toBe(true)
      // So it cannot be mistaken for a whole backup at the moment somebody
      // needs it to be one.
      expect(manifest.omitted.length).toBeGreaterThan(0)
    } finally {
      await fs.promises.rm(essential, { recursive: true, force: true })
    }
  }, 120000)

  it('refuses a scope it does not recognise rather than writing a partial backup', async () => {
    await expect(backups.backup({ outputDir: directory, scope: 'some' })).rejects.toThrow(BackupError)
  })
})

describe('putting it back', () => {
  it('will not restore without being told that is intended', async () => {
    // Every graph in the backup is dropped before it is rewritten.
    await expect(backups.restore({ directory })).rejects.toThrow(/confirm/)
  })

  it('refuses a directory that is not a backup', async () => {
    await expect(BackupBuilder.readManifest(os.tmpdir())).rejects.toThrow(/not a backup/)
  })

  it('restores a graph that has been destroyed', async () => {
    // The assertion the whole thing exists for.
    const before = await count(SCRATCH)
    expect(before).toBeGreaterThan(1000)

    await client.update(`DROP SILENT GRAPH ${iri(SCRATCH)}`)
    expect(await count(SCRATCH)).toBe(0)

    const report = await backups.restore({ directory, confirm: true, only: [SCRATCH] })
    expect(report.restored).toHaveLength(1)
    expect(await count(SCRATCH)).toBe(before)
  }, 120000)

  it('brings every blank node back whole, including across batch boundaries', async () => {
    // The real failure: a restore reported the right triple count while 114 of
    // 594 ports had lost their symbol, type and range, because grouping by
    // subject puts a blank node's own triples in a different group from the
    // triple that points at it.
    const [orphans] = await client.select(`
      SELECT (COUNT(*) AS ?n) WHERE {
        GRAPH ${iri(SCRATCH)} {
          ${iri(subject)} ${iri(NAMESPACES.lv2 + 'port')} ?port .
          FILTER NOT EXISTS { ?port ${iri(NAMESPACES.lv2 + 'symbol')} ?symbol }
        }
      }`)
    expect(Number(orphans.n), 'blank nodes were cut in half by the restore').toBe(0)

    const [row] = await client.select(`
      SELECT ?symbol ?name WHERE {
        GRAPH ${iri(SCRATCH)} {
          ${iri(subject)} ${iri(NAMESPACES.lv2 + 'port')} ?port .
          ?port ${iri(NAMESPACES.lv2 + 'symbol')} ${literal('gain')} ; ${iri(NAMESPACES.lv2 + 'name')} ?name .
          BIND("gain" AS ?symbol)
        }
      }`)
    expect(row?.name).toBe('Gain')
  })

  it('brings a quoted, multi-line literal back unchanged', async () => {
    const [row] = await client.select(`
      SELECT ?comment WHERE {
        GRAPH ${iri(SCRATCH)} { ${iri(subject)} ${iri(NAMESPACES.rdfs + 'comment')} ?comment }
      }`)
    expect(row.comment).toBe('A "quoted" line,\nand a second.')
  })

  it('refuses to report success if the restored count does not match', async () => {
    // A restore that says it worked without counting makes the same promise an
    // untested backup does.
    const tampered = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-tampered-'))
    try {
      await backups.backup({ outputDir: tampered, scope: 'essential' })
      const manifestFile = path.join(tampered, 'MANIFEST.json')
      const manifest = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8'))
      manifest.graphs = [{ ...manifest.graphs[0], triples: manifest.graphs[0].triples + 99 }]
      await fs.promises.writeFile(manifestFile, JSON.stringify(manifest))
      await expect(backups.restore({ directory: tampered, confirm: true }))
        .rejects.toThrow(/recorded/)
    } finally {
      await fs.promises.rm(tampered, { recursive: true, force: true })
    }
  }, 120000)
})
