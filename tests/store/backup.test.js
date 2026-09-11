import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import BackupBuilder, { BackupError, isIrreplaceable, isMeasurement, SCOPES } from '../../src/store/BackupBuilder.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
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

/**
 * Carrying measurements from the machine that made them to the one that serves.
 *
 * The profiler runs untrusted native code and wants room; the catalogue is
 * served from a small box that should not be profiling while it serves. So a
 * run is made here and delivered there, which the architecture always intended
 * ("measurements are portable — they carry their platform") and nothing
 * implemented: the live catalogue held zero measurements while /about/measurements
 * explained what they meant.
 *
 * The thing that makes this more than a file copy is the registry. A graph
 * arriving as bare triples has no licence, so the CC0 dump cannot see it, and
 * no run, so nothing says which machine produced it. The whole registry cannot
 * travel with it — on the receiving host that row set describes a hundred
 * graphs this backup has never heard of.
 */
describe('carrying measurements to another host', () => {
  const RUN = 'graph:profiler/test-carry'
  const registry = new GraphRegistry(client)
  let carried

  beforeAll(async () => {
    await registry.register({
      kind: 'profiler',
      id: 'test-carry',
      licence: 'CC0-1.0',
      derivedFrom: `${NAMESPACES.pu}profiler/test-carry`,
      runId: 'test-carry-run',
      comment: 'a scan that happened somewhere else',
      generatedAt: new Date('2020-01-02T03:04:05Z')
    })
    await client.update(insertDataQuery(RUN, [
      `${iri(subject)} ${iri(NAMESPACES.pu + 'metric')} ${iri(NAMESPACES.pu + 'ScanTime')} .`
    ]))
    carried = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-carry-'))
  }, 60000)

  afterAll(async () => {
    await registry.drop('profiler', 'test-carry')
    await client.update(`DROP SILENT GRAPH ${iri(RUN)}`)
    if (carried) await fs.promises.rm(carried, { recursive: true, force: true })
  })

  it('is one of the scopes, and knows a profiler graph from any other', () => {
    expect(SCOPES).toContain('measurements')
    expect(isMeasurement(RUN)).toBe(true)
    expect(isMeasurement('graph:source/downspout')).toBe(false)
    expect(isMeasurement(SCRATCH)).toBe(false)
  })

  it('carries the profiler runs and nothing else', async () => {
    const manifest = await backups.backup({ outputDir: carried, scope: 'measurements' })
    expect(manifest.graphs.length).toBeGreaterThan(0)
    expect(manifest.graphs.every(entry => isMeasurement(entry.graph))).toBe(true)
    // The scratch graph is in the store and must not be in this backup: a
    // delivery that quietly included a harvested source would overwrite it on
    // arrival with whatever this machine happened to hold.
    expect(manifest.graphs.map(entry => entry.graph)).not.toContain(SCRATCH)
  })

  it('gives every graph its registration, so it arrives attributable', async () => {
    const manifest = await BackupBuilder.readManifest(carried)
    const entry = manifest.graphs.find(graph => graph.graph === RUN)
    expect(entry.registration).toMatchObject({
      kind: 'profiler',
      id: 'test-carry',
      licence: 'CC0-1.0',
      runId: 'test-carry-run'
    })
    // The run's own time, not the time of the copy.
    expect(entry.registration.generatedAt).toContain('2020-01-02')
  })

  it('refuses to carry a graph the registry cannot account for', async () => {
    const orphan = 'graph:profiler/test-orphan'
    await client.update(insertDataQuery(orphan, [
      `${iri(subject)} ${iri(NAMESPACES.rdfs + 'label')} ${literal('orphan')} .`
    ]))
    try {
      await expect(backups.backup({ outputDir: carried, scope: 'measurements' }))
        .rejects.toThrow(/not in the registry/)
    } finally {
      await client.update(`DROP SILENT GRAPH ${iri(orphan)}`)
    }
  })

  it('restores the registration as well as the triples, and leaves the rest of the registry alone', async () => {
    const before = (await registry.list()).length
    await registry.drop('profiler', 'test-carry')
    await client.update(`DROP SILENT GRAPH ${iri(RUN)}`)
    expect((await registry.list()).length).toBe(before - 1)

    await backups.restore({ directory: carried, confirm: true, only: [RUN] })

    const after = await registry.list()
    expect(after.length, 'the registry gained or lost rows it should not have').toBe(before)
    const row = after.find(entry => entry.graph === RUN)
    expect(row.licence).toBe('CC0-1.0')
    expect(row.harvestRun).toBe('test-carry-run')
    // Re-stamping this on arrival would make the graph claim to be newer than
    // the readings inside it.
    expect(row.generatedAtTime).toContain('2020-01-02')
    expect(await count(RUN)).toBe(1)
  })
})

/**
 * What a restore says when it is pointed at something that is not a backup.
 *
 * All three of these happened on the way to delivering measurements to the
 * server, and the message was the same for each: "has no MANIFEST.json; it is
 * not a backup." True, and it names the file that is missing rather than the
 * reason it is missing — which is the part the reader is standing in front of a
 * server trying to work out.
 */
describe('being pointed at something that is not a backup', () => {
  let scratch

  beforeAll(async () => {
    scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-notbackup-'))
  })

  afterAll(async () => {
    if (scratch) await fs.promises.rm(scratch, { recursive: true, force: true })
  })

  it('finds a backup one directory down and says so', async () => {
    // `rsync -a dir host:/dest/` without the trailing slash on the source puts
    // the backup at /dest/dir, and the restore is then pointed at its parent.
    const parent = path.join(scratch, 'parent')
    const inner = path.join(parent, 'the-backup')
    await fs.promises.mkdir(inner, { recursive: true })
    await fs.promises.writeFile(path.join(inner, 'MANIFEST.json'),
      JSON.stringify({ format: 'turtle-per-graph/1', scope: 'full', graphs: [] }))

    await expect(BackupBuilder.readManifest(parent)).rejects.toThrow(/but .*the-backup does/)
    await expect(BackupBuilder.readManifest(parent)).rejects.toThrow(/trailing slash/)
  })

  it('recognises graph files copied without their manifest', async () => {
    // Turtle carries no graph name, so the files alone cannot say where they
    // go. Somebody carrying "just the one run" copies the .ttl they want.
    const partial = path.join(scratch, 'partial')
    await fs.promises.mkdir(partial, { recursive: true })
    await fs.promises.writeFile(path.join(partial, 'profiler-pluginval-1.ttl'), '# turtle\n')

    await expect(BackupBuilder.readManifest(partial)).rejects.toThrow(/Turtle carries no graph name/)
    await expect(BackupBuilder.readManifest(partial)).rejects.toThrow(/--graph/)
  })

  it('lists what it did find, when it is neither of those', async () => {
    const other = path.join(scratch, 'other')
    await fs.promises.mkdir(other, { recursive: true })
    await fs.promises.writeFile(path.join(other, 'notes.txt'), 'hello')

    await expect(BackupBuilder.readManifest(other)).rejects.toThrow(/It holds: notes\.txt/)
  })

  it('still says plainly when the directory is not there at all', async () => {
    await expect(BackupBuilder.readManifest(path.join(scratch, 'nope')))
      .rejects.toThrow(/does not exist/)
  })
})

/**
 * Uploaded pictures, which are the first irreplaceable thing here that is not a
 * triple.
 *
 * `isIrreplaceable` reasons entirely about graph names and could not see them.
 * An essential backup that took every account and every contribution and
 * silently left the images behind would be exactly the kind of backup that is
 * discovered to be incomplete at the moment somebody needs it.
 */
describe('images in a backup', () => {
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)])
  let store
  let stored
  let out

  beforeAll(async () => {
    const { ImageStore } = await import('../../src/api/ImageStore.js')
    store = new ImageStore()
    stored = await store.store(PNG)
    out = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-image-backup-'))
  }, 60000)

  afterAll(async () => {
    await fs.promises.rm(store.fileFor(stored.name), { force: true })
    if (out) await fs.promises.rm(out, { recursive: true, force: true })
  })

  it('carries them in an essential backup and counts them', async () => {
    const manifest = await backups.backup({ outputDir: out, scope: 'essential' })
    expect(manifest.files.map(file => file.name)).toContain(stored.name)
    expect(manifest.fileBytes).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(out, 'images', stored.name))).toBe(true)
  })

  it('puts them back, and refuses if one named in the manifest is missing', async () => {
    await fs.promises.rm(store.fileFor(stored.name), { force: true })
    const report = await backups.restore({ directory: out, confirm: true })
    expect(report.files).toBeGreaterThan(0)
    expect(fs.existsSync(store.fileFor(stored.name))).toBe(true)

    await fs.promises.rm(path.join(out, 'images', stored.name), { force: true })
    await expect(backups.restore({ directory: out, confirm: true }))
      .rejects.toThrow(/silently lose a picture/)
  })
})
