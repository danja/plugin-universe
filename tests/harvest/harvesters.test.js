import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import DownspoutHarvester from '../../src/harvest/DownspoutHarvester.js'
import Lv2Harvester from '../../src/harvest/Lv2Harvester.js'
import { Harvester, HarvestError } from '../../src/harvest/Harvester.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

// Harvesters are tested against the real seed repositories. They exist to read
// one specific corpus correctly, so a synthetic fixture would test nothing.

const DOWNSPOUT = process.env.DOWNSPOUT_PATH ?? '/home/danny/github/downspout'
const FLUES = process.env.FLUES_PATH ?? '/home/danny/github/flues'
const trn = NAMESPACES.trn

const haveSeed = fs.existsSync(DOWNSPOUT) && fs.existsSync(FLUES)

describe('the harvester contract', () => {
  it('requires a licence to be declared, with no default', () => {
    expect(() => new Harvester({ id: 'x', kind: 'source', derivedFrom: 'y' })).toThrow(HarvestError)
  })

  it('requires provenance', () => {
    expect(() => new Harvester({ id: 'x', kind: 'source', licence: 'CC0-1.0' })).toThrow(HarvestError)
  })

  it('does not pretend to collect', async () => {
    const bare = new Harvester({ id: 'x', kind: 'source', licence: 'CC0-1.0', derivedFrom: 'y' })
    await expect(bare.collect()).rejects.toThrow(HarvestError)
  })
})

describe.skipIf(!haveSeed)('DownspoutHarvester', () => {
  let result
  beforeAll(async () => {
    result = await new DownspoutHarvester({ repoPath: DOWNSPOUT }).harvest()
  })

  it('reads every plugin directory with a profile, rejecting none', () => {
    expect(result.plugins.length).toBeGreaterThanOrEqual(50)
    expect(result.rejected).toEqual([])
  })

  it('reads the odd one out that is LV2/DOAP-shaped rather than a trn:PluginProfile', () => {
    // plugins/worms uses lv2:Plugin + doap:name. A hand-maintained corpus
    // drifts; the harvester reads both shapes.
    const worms = result.plugins.find(p => p.name === 'ToneWorm')
    expect(worms).toBeDefined()
    expect(worms.description).toContain('Tonnetz')
  })

  it('normalises both min/max spellings onto one', () => {
    const bassops = result.plugins.find(p => p.name === 'Bassops')
    const duck = bassops.parameters.find(p => p.symbol === 'duck_depth')
    expect(duck.minimum).toBe(0)
    expect(duck.maximum).toBe(100)
    expect(duck.unitIri).toBe(`${NAMESPACES.units}pc`)
  })

  it('carries curated behaviour that no scanner could produce', () => {
    const drift = result.plugins.find(p => p.name === 'Drift')
    expect(drift.roles).toContain(`${trn}MidiGenerator`)
    expect(drift.produces).toContain(`${trn}ControlMidi`)
    expect(drift.requires).toContain(`${trn}HostTransport`)
    expect(drift.cautions.length).toBeGreaterThan(0)
  })

  it('reads CC mappings', () => {
    const withCc = result.plugins.filter(p => p.ccMappings.length > 0)
    expect(withCc.length).toBeGreaterThan(0)
    const mapping = withCc[0].ccMappings[0]
    expect(typeof mapping.ccNumber).toBe('number')
  })

  it('marks every plugin as VST3', () => {
    expect(result.plugins.every(p => p.formats.includes(`${trn}VST3`))).toBe(true)
  })
})

describe.skipIf(!haveSeed)('Lv2Harvester', () => {
  let result
  beforeAll(async () => {
    result = await new Lv2Harvester({
      repoPath: FLUES, id: 'flues', licence: 'MIT',
      derivedFrom: 'https://github.com/danja/flues', vendor: 'Danny Ayers'
    }).harvest()
  })

  it('reads every source bundle, rejecting none', () => {
    expect(result.plugins.length).toBeGreaterThanOrEqual(36)
    expect(result.rejected).toEqual([])
  })

  it('skips build, staging and release copies of the same bundle', async () => {
    // flues carries each bundle up to four times: lv2/<n>/<n>.lv2 plus
    // build-output/, releases/ and build/staging/. Harvesting all of them
    // produced 57 records for 36 plugins.
    const bundles = await new Lv2Harvester({
      repoPath: FLUES, id: 'flues', licence: 'MIT', derivedFrom: 'x'
    }).findBundles(FLUES)
    expect(bundles.every(b => !/\/(build|build-output|releases|staging|dist)\//.test(b))).toBe(true)
  })

  it('yields one record per canonical IRI', () => {
    const iris = result.plugins.map(p => p.sourceIri)
    expect(new Set(iris).size).toBe(iris.length)
  })

  it('preserves the upstream canonical IRI', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.sourceIri).toBe('https://danja.github.io/flues/plugins/shifty')
  })

  it('reads ports as parameters with no translation', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    const blockBars = shifty.parameters.find(p => p.symbol === 'block_bars')
    expect(blockBars.minimum).toBe(1)
    expect(blockBars.maximum).toBe(8)
    expect(blockBars.default).toBe(2)
    expect(blockBars.integer).toBe(true)
  })

  it('ignores audio and atom ports, which are connectivity not parameters', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.parameters.some(p => p.symbol === 'in_l')).toBe(false)
    expect(shifty.parameters.some(p => p.symbol === 'control')).toBe(false)
  })

  it('derives signal types from the port list', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.accepts).toContain(`${trn}Audio`)
    expect(shifty.produces).toContain(`${trn}Audio`)
  })

  it('infers a host transport requirement from a time:Position port', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.requires).toContain(`${trn}HostTransport`)
  })

  it('preserves scale points as enumerations', () => {
    const withScale = result.plugins.find(p => p.parameters.some(x => x.scalePoints.length > 0))
    expect(withScale).toBeDefined()
    const param = withScale.parameters.find(p => p.scalePoints.length > 0)
    expect(param.scalePoints[0].label).toBeTruthy()
    expect(typeof param.scalePoints[0].value).toBe('number')
  })

  it('records the per-repository licence from the bundle itself', () => {
    expect(result.plugins.every(p => p.licence?.includes('MIT'))).toBe(true)
  })

  it('output ports are marked as such, not treated as controls to set', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    const active = shifty.parameters.find(p => p.symbol === 'active_division')
    expect(active.direction).toBe('output')
  })
})
