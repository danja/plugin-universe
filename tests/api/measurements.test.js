import { describe, it, expect } from 'vitest'
import { renderMeasurements, renderPluginPage } from '../../src/api/render.js'

/**
 * The profiler's readings, on the page.
 *
 * These were written into the store from the day the profiler landed and
 * displayed nowhere — MISTAKES.md pattern 3, for the fourth time. Showing them
 * found two defects within a minute: a scan time rendered as a bare "364" when
 * the vocabulary said milliseconds, and `pu:Latency` carrying a boolean while
 * the vocabulary defined it as a count of samples.
 */

const RUN = {
  run: 'lv2-scan-2026-09-07T11:39:31.602Z',
  at: '2026-09-07T11:39:31.603Z',
  tool: 'lilv lv2info (debian bookworm)',
  platform: 'Linux 6.8.0-137-generic x64',
  verdict: 'ok',
  readings: [
    { metric: 'ValidationResult', label: 'Validation result', value: 'ok', unit: null, note: null, about: null },
    { metric: 'ScanTime', label: 'Scan time', value: '364', unit: 'http://lv2plug.in/ns/extensions/units#ms', note: null, about: 'Time to enumerate the plugin.' },
    { metric: 'Latency', label: 'Reports latency', value: 'false', unit: null, note: 'The plugin reports no latency.', about: null }
  ]
}

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/chatgen-08402a74',
  name: 'ChatGen', vendor: 'danja', description: 'A generator.',
  formats: ['LV2'], categories: [], roles: [], tags: [], parameters: []
}

describe('a measured plugin', () => {
  const html = renderMeasurements(RUN)

  it('states the verdict', () => {
    expect(html).toContain('ok')
    expect(html).toMatch(/Measured/)
  })

  it('gives a number its unit', () => {
    // "364" alone was on the page, and the vocabulary was the only place that
    // said what it counted.
    expect(html).toContain('364 ms')
  })

  it('reads a boolean as a word, not as a failure', () => {
    // `false` in a column of measurements reads as "this did not work".
    expect(html).toContain('no')
    expect(html).not.toMatch(/>false</)
  })

  it('says which tool, which machine and which day', () => {
    // A reading without them is not a measurement: it describes one binary on
    // one host on one date, and the next run may disagree.
    expect(html).toContain('lilv lv2info')
    expect(html).toContain('Linux 6.8.0-137-generic x64')
    expect(html).toContain('2026-09-07')
  })

  it('does not repeat the verdict as a row of its own', () => {
    expect(html.match(/Validation result/g)).toBeNull()
  })

  it('carries the vocabulary\'s explanation of a metric', () => {
    expect(html).toContain('Time to enumerate the plugin.')
  })

  it('renders nothing at all for a plugin nothing has measured', () => {
    // The overwhelming majority. An empty "Measured" heading on 745 pages
    // would be worse than no feature.
    expect(renderMeasurements(null)).toBe('')
    expect(renderMeasurements({ ...RUN, readings: [] })).toBe('')
  })
})

describe('the plugin page', () => {
  it('includes the measurements when there are some', () => {
    expect(renderPluginPage(DOC, {}, null, RUN)).toContain('364 ms')
  })

  it('is unchanged for a plugin with none', () => {
    const page = renderPluginPage(DOC, {}, null, null)
    expect(page).toContain('ChatGen')
    expect(page).not.toContain('Measured')
  })
})
