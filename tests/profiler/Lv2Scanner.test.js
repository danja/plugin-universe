import { describe, it, expect } from 'vitest'
import fs from 'fs'
import Lv2Scanner from '../../src/profiler/Lv2Scanner.js'
import Sandbox, { OUTCOME, signalOf } from '../../src/profiler/Sandbox.js'

/**
 * The parser runs against real lv2info output, captured from a real scan of a
 * real built bundle. A hand-written sample would be a test of my idea of the
 * format rather than of the format.
 *
 * The sandbox itself is exercised in tests/profiler/sandbox.test.js, which
 * needs a container runtime; the classification below is arithmetic over an
 * exit code and needs nothing.
 */

const REPORT = fs.readFileSync('tests/fixtures/lv2info-chatgen.txt', 'utf8')

describe('parsing lv2info', () => {
  const parsed = Lv2Scanner.parse(REPORT)

  it('reads what the binary says it is', () => {
    expect(parsed.name).toBe('ChatGen')
    expect(parsed.binary).toMatch(/chatgen\.so$/)
    expect(parsed.hasLatency).toBe(false)
  })

  it('keeps every type of a multi-typed port', () => {
    // A port is an AtomPort *and* an InputPort. Reading only the first loses
    // the direction, and the terminator that seemed obvious — any word before a
    // colon — stops at the first continuation URI, because "http:" looks
    // exactly like a label.
    const control = parsed.ports.find(port => port.symbol === 'control')
    expect(control.types).toEqual(expect.arrayContaining([
      'http://lv2plug.in/ns/ext/atom#AtomPort',
      'http://lv2plug.in/ns/lv2core#InputPort'
    ]))
    expect(control.types.length).toBeGreaterThan(1)
  })

  it('separates control ports from the rest, because the profile counts only those', () => {
    const control = parsed.ports.filter(p => p.types.some(t => t.endsWith('#ControlPort')))
    expect(parsed.ports.length).toBeGreaterThan(control.length)
    expect(control.map(p => p.symbol)).toEqual(expect.arrayContaining(['play', 'loop']))
  })

  it('reads port ranges as numbers', () => {
    const play = parsed.ports.find(port => port.symbol === 'play')
    expect(play.minimum).toBe(0)
    expect(play.maximum).toBe(1)
    expect(play.default).toBe(1)
  })

  it('reads the feature lists without swallowing the next section', () => {
    expect(parsed.requiredFeatures).toEqual(['http://lv2plug.in/ns/ext/urid#map'])
    expect(parsed.optionalFeatures.every(f => f.startsWith('http'))).toBe(true)
  })

  it('distinguishes "no" from "not stated"', () => {
    // hasLatency is a three-valued answer. Coercing an absent one to false
    // would assert something the tool never said.
    expect(Lv2Scanner.parse('\tName: X\n').hasLatency).toBeNull()
  })

  it('returns nothing rather than guessing at empty output', () => {
    const empty = Lv2Scanner.parse('')
    expect(empty.name).toBeNull()
    expect(empty.ports).toEqual([])
  })
})

describe('how a run ended', () => {
  const classify = (code, signal = null, timedOut = false) =>
    Sandbox.classify({ code, signal, timedOut })

  it('treats a clean exit as ok', () => {
    expect(classify(0)).toBe(OUTCOME.OK)
  })

  it('treats a tool reporting a bad plugin as a failure, not a crash', () => {
    expect(classify(1)).toBe(OUTCOME.FAILED)
  })

  it('recognises a crash reported as 128 + signal', () => {
    // This is the case that matters and the one that was wrong: a container's
    // exit code is its PID 1's, so a plugin taking the scanning tool down
    // arrives as exit 139 with no signal field set at all. Read as an ordinary
    // non-zero exit, it loses the difference between "malformed" and "took the
    // host process with it".
    expect(classify(139)).toBe(OUTCOME.CRASHED)
    expect(classify(134)).toBe(OUTCOME.CRASHED)
    expect(signalOf({ code: 139, signal: null })).toBe('SIGSEGV')
    expect(signalOf({ code: 134, signal: null })).toBe('SIGABRT')
  })

  it('recognises an out-of-memory kill', () => {
    expect(classify(137)).toBe(OUTCOME.CRASHED)
  })

  it('reports a signal delivered directly', () => {
    expect(classify(null, 'SIGSEGV')).toBe(OUTCOME.CRASHED)
    expect(signalOf({ code: null, signal: 'SIGSEGV' })).toBe('SIGSEGV')
  })

  it('reports a hang as a timeout rather than a crash', () => {
    expect(classify(null, 'SIGKILL', true)).toBe(OUTCOME.TIMED_OUT)
  })

  it('has no signal to report for an ordinary exit', () => {
    expect(signalOf({ code: 1, signal: null })).toBeNull()
  })
})
