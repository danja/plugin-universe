import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import { LICENCES } from '../../src/store/GraphRegistry.js'
import DumpBuilder, { sectionFor, fileNameFor, DumpError } from '../../src/store/DumpBuilder.js'
import { parseTurtleFile } from '../../src/harvest/TurtleReader.js'

/**
 * Publishing the dataset.
 *
 * The whole per-graph licensing design exists so that this is a **selection
 * over a flag**, not a review of individual statements. What these tests guard
 * is the direction that cannot be taken back: something published that should
 * not have been. A missing graph is an inconvenience; a personal-data graph in
 * a public dump is a notifiable one.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
let outputDir
let report

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-dump-'))
  report = await new DumpBuilder(client, { outputDir }).build()
}, 120000)

afterAll(async () => {
  if (outputDir) await fs.promises.rm(outputDir, { recursive: true, force: true })
})

describe('which part a licence belongs in', () => {
  it('sorts every licence the registry knows into exactly one section', () => {
    // The two-lists-must-agree guard. A licence added to LICENCES without a
    // decision about publication would otherwise be discovered at publication
    // time, which is the worst moment to discover it.
    for (const [name, terms] of Object.entries(LICENCES)) {
      const section = sectionFor(name)
      if (!terms.redistributable) expect(section, name).toBeNull()
      else expect(['cc0', 'notice', 'prose'], name).toContain(section)
    }
  })

  it('puts public-domain-equivalent terms in the CC0 dataset', () => {
    for (const name of ['CC0-1.0', 'Unlicense', '0BSD']) expect(sectionFor(name), name).toBe('cc0')
  })

  it('gives share-alike its own dataset rather than filing it as a notice', () => {
    // CC BY-SA carries a notice *and* governs what a consumer may build from
    // it. Only the second decides which dataset it belongs to, and treating it
    // as merely notice-carrying would misdescribe it and the permissive
    // material it was mixed with.
    expect(sectionFor('CC-BY-SA-4.0')).toBe('prose')
    expect(sectionFor('CC-BY-4.0')).toBe('notice')
    expect(sectionFor('MIT')).toBe('notice')
  })

  it('withholds anything not redistributable', () => {
    expect(sectionFor('personal-data')).toBeNull()
    expect(sectionFor('proprietary-linkout')).toBeNull()
  })

  it('refuses a licence it does not recognise rather than guessing', () => {
    // Guessing here publishes something, and publishing cannot be undone.
    expect(() => sectionFor('WTFPL')).toThrow(DumpError)
  })

  it('turns a graph IRI into a filename that cannot escape the directory', () => {
    expect(fileNameFor('graph:source/downspout')).toBe('source-downspout.ttl')
    expect(() => fileNameFor('graph:../../etc/passwd')).toThrow(DumpError)
  })
})

describe('the dataset as written', () => {
  it('publishes something', () => {
    expect(report.parts.cc0.graphs.length).toBeGreaterThan(0)
  })

  it('writes no file for a graph it withheld', () => {
    // The assertion that matters. Everything else here is tidiness.
    expect(report.withheld.length).toBeGreaterThan(0)
    const written = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name))
        else written.push(entry.name)
      }
    }
    walk(outputDir)
    for (const graph of report.withheld) {
      expect(written, `${graph.graph} was withheld and written anyway`)
        .not.toContain(fileNameFor(graph.graph))
    }
  })

  it('withholds the graphs holding personal data', () => {
    const withheld = report.withheld.map(row => row.graph)
    expect(withheld).toContain('graph:system/accounts')
    expect(withheld).toContain('graph:system/corrections')
  })

  it('publishes no account name or login from the accounts graph', () => {
    // Vendor names are catalogue facts and do appear; what must not appear is
    // anything only the accounts graph knows.
    const contents = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ttl')) contents.push(fs.readFileSync(full, 'utf8'))
      }
    }
    walk(outputDir)
    const published = contents.join('\n')
    for (const predicate of ['foaf/0.1/accountName', 'plugin-universe/trustLevel', 'plugin-universe/suspended']) {
      // As a statement about a subject, not as a term definition in the
      // ontology — which is published, and should be.
      const asData = new RegExp(`person/[^>\\s]+>\\s*[^.]*${predicate.replace(/[/.]/g, '\\\\$&')}`)
      expect(published, `${predicate} appears as data`).not.toMatch(asData)
    }
  })

  it('says what it withheld and why', () => {
    for (const graph of report.withheld) {
      expect(graph.reason).toBeTruthy()
      expect(graph.licence).toBeTruthy()
    }
    expect(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8')).toMatch(/not here/i)
  })

  it('describes itself in VoID that parses', async () => {
    const dataset = await parseTurtleFile(path.join(outputDir, 'void.ttl'))
    expect(dataset.size).toBeGreaterThan(10)
  })

  it('writes a manifest naming each file\'s graph and licence', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'MANIFEST.json'), 'utf8'))
    for (const part of Object.values(manifest.parts)) {
      for (const graph of part.graphs) {
        expect(graph.graph).toBeTruthy()
        expect(graph.licence).toBeTruthy()
        expect(fs.existsSync(path.join(outputDir, graph.file)), graph.file).toBe(true)
      }
    }
  })

  it('writes a notices file even when nothing requires a notice', () => {
    // Absent reads as an oversight; present and saying "none" reads as an
    // answer.
    expect(fs.existsSync(path.join(outputDir, 'notice/NOTICES.txt'))).toBe(true)
  })

  it('every published file parses as Turtle', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'MANIFEST.json'), 'utf8'))
    for (const part of Object.values(manifest.parts)) {
      for (const graph of part.graphs) {
        const dataset = await parseTurtleFile(path.join(outputDir, graph.file))
        expect(dataset.size, graph.file).toBeGreaterThan(0)
      }
    }
  }, 120000)

  it('leaves nothing behind from a previous run', async () => {
    // A graph that changes section left its old file in the old section, so
    // CC BY-SA prose was published twice under two different sets of terms.
    const stray = path.join(outputDir, 'cc0', 'source-gone-away.ttl')
    await fs.promises.writeFile(stray, '# from a previous run\n')
    await new DumpBuilder(client, { outputDir }).build()
    expect(fs.existsSync(stray), 'a stale file survived a rebuild').toBe(false)
  }, 120000)
})
