import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import PluginvalScanner, { HOSTED_FORMATS } from '../../src/profiler/PluginvalScanner.js'

const SUCCESS_LOG = readFileSync('tests/fixtures/profiler/pluginval-moka-success.txt', 'utf8')

/**
 * Reading pluginval's log.
 *
 * The log is prose written for a person, so the parser is deliberately narrow:
 * it matches only lines pluginval emits verbatim from its own source, and
 * leaves anything else alone. Lv2Scanner learned this the expensive way — a
 * terminator that matched "any word followed by a colon" stopped at the first
 * URI, and silently truncated every multi-typed port to its first type.
 *
 * The fixture below is real output, from `pluginval --validate` on a downspout
 * VST3 inside the profiler image. Reconstructing it from the source would test
 * what pluginval was believed to print.
 */

describe('which files pluginval can be pointed at', () => {
  it('recognises the formats this build hosts', () => {
    expect(PluginvalScanner.bundles(['moka.vst3', 'chatgen.lv2', 'thing.clap']))
      .toEqual([
        { name: 'chatgen.lv2', format: 'LV2' },
        { name: 'moka.vst3', format: 'VST3' },
        { name: 'thing.clap', format: 'CLAP' }
      ])
  })

  it('leaves a bare shared object alone', () => {
    // LADSPA and VST2 both ship as a plain .so, and this build has no VST2 SDK
    // anyway. Guessing would file the reading under the wrong format.
    expect(PluginvalScanner.bundles(['delay.so', 'libfoo.so.1'])).toEqual([])
  })

  it('ignores everything that is not a plugin', () => {
    expect(PluginvalScanner.bundles(['README.md', 'build', '.gitignore', 'x.vst3.zip']))
      .toEqual([])
  })

  it('is case-insensitive about the suffix', () => {
    expect(PluginvalScanner.bundles(['Moka.VST3'])).toEqual([{ name: 'Moka.VST3', format: 'VST3' }])
  })

  it('has an entry for every format the scanner claims to host', () => {
    expect(Object.values(HOSTED_FORMATS)).toContain('VST3')
    expect(Object.keys(HOSTED_FORMATS).every(suffix => suffix.startsWith('.'))).toBe(true)
  })
})

describe('JUCE duration descriptions', () => {
  it('reads milliseconds', () => {
    expect(PluginvalScanner.durationMs('345 ms')).toBe(345)
  })

  it('reads seconds, singular and plural', () => {
    expect(PluginvalScanner.durationMs('1 sec')).toBe(1000)
    expect(PluginvalScanner.durationMs('2 secs')).toBe(2000)
  })

  it('adds the fields of a compound description', () => {
    expect(PluginvalScanner.durationMs('1 min 3 secs')).toBe(63000)
  })

  it('is null for anything it does not recognise', () => {
    // Not zero. "No figure" and "took no time" are different claims, and a
    // zero would be published as a measurement.
    expect(PluginvalScanner.durationMs('')).toBeNull()
    expect(PluginvalScanner.durationMs(null)).toBeNull()
    expect(PluginvalScanner.durationMs('ages')).toBeNull()
  })
})

describe('a real pluginval log', () => {
  const parsed = PluginvalScanner.parse(SUCCESS_LOG)

  it('takes the verdict from the word pluginval prints', () => {
    // Not from counting failures here. pluginval has already concluded, and a
    // second opinion assembled by this parser could disagree with it.
    expect(parsed.verdict).toBe('SUCCESS')
    expect(parsed.started).toBe(true)
    expect(parsed.timedOut).toBe(false)
  })

  it('reads the conditions the run was made under', () => {
    expect(parsed.strictness).toBe(5)
    expect(parsed.pluginsFound).toBe(1)
  })

  it('identifies the plugin pluginval actually loaded', () => {
    // From the binary, not from the file name. This is the scan winning over
    // the profile, which is the point of measuring at all.
    expect(parsed.identifier).toBe('VST3-Moka-8489fdc5-33846176')
    expect(parsed.manufacturer).toBe('danja')
    expect(parsed.name).toBe('Moka')
    expect(parsed.version).toBe('0.1.0')
  })

  it('names the tests that ran, without the unit-test category', () => {
    // The line reads "Starting tests in: pluginval / Open plugin (cold)...".
    // An earlier version of this regex matched "Starting test:", which is how
    // the source reads and not how the tool prints, and found nothing at all.
    expect(parsed.tests.length).toBeGreaterThan(4)
    expect(parsed.tests).toContain('Open plugin (cold)')
    expect(parsed.tests.every(name => !name.startsWith('pluginval'))).toBe(true)
  })

  it('reports no failures for a plugin that passed', () => {
    expect(parsed.failures).toEqual([])
  })

  it('reads the instantiation times', () => {
    expect(parsed.openColdMs).toBe(162)
    expect(parsed.openWarmMs).toBe(11)
    expect(parsed.openColdText).toBe('162 ms')
  })

  it('reads latency in samples, which only a running host can say', () => {
    // pu:LatencySamples was defined and nothing produced it: lilv can see that
    // a latency port exists, not what the plugin reports through it.
    expect(parsed.reportedLatency).toBe(0)
  })
})

describe('a pluginval log from a plugin that was never found', () => {
  // The shape of the bookworm failure: pluginval ran, scanned, and found
  // nothing to test, because the container's glibc was older than the one the
  // plugin was built against.
  const parsed = PluginvalScanner.parse([
    'Started validating: /plugin/moka.vst3',
    'Validation started',
    'Strictness level: 5',
    'Starting tests in: pluginval / Scan for plugins located in: /plugin/moka.vst3...',
    'Num plugins found: 0',
    '!!! Test 1 failed: No types found. This usually means the plugin binary is missing or damaged.',
    'FAILURE',
    '*** FAILED'
  ].join('\n'))

  it('is a failure with nothing identified', () => {
    expect(parsed.verdict).toBe('FAILURE')
    expect(parsed.pluginsFound).toBe(0)
    expect(parsed.name).toBeNull()
    expect(parsed.failures).toHaveLength(1)
  })

  it('has no timings, rather than zero ones', () => {
    expect(parsed.openColdMs).toBeNull()
    expect(parsed.reportedLatency).toBeNull()
  })
})
