import { describe, it, expect } from 'vitest'
import { groupDownloads, downloadLabel } from '../../src/search/documents.js'
import QueryService from '../../src/store/QueryService.js'

/**
 * Direct downloads, grouped and labelled.
 *
 * `pu:downloadUrl` is written per package file and read back by one query —
 * `plugin/downloads.sparql`, one row per file. The grouping from rows to a
 * plugin's file list is pure and lives in `documents.js` beside the other
 * document-shape decisions; the query itself is checked below by loading it,
 * which is everything a core test can do without a store.
 */

const PLUGIN = 'http://purl.org/stuff/plugin-universe/plugin/a-12345678'

describe('grouping download rows by plugin', () => {
  it('groups files under their plugin and splits the systems', () => {
    const grouped = groupDownloads([
      { plugin: PLUGIN, url: 'https://example.invalid/a-win.zip', systems: 'win' },
      { plugin: PLUGIN, url: 'https://example.invalid/a-mac.dmg', systems: 'mac' }
    ])
    expect(grouped.get(PLUGIN)).toEqual([
      { url: 'https://example.invalid/a-win.zip', systems: ['win'] },
      { url: 'https://example.invalid/a-mac.dmg', systems: ['mac'] }
    ])
  })

  it('keeps a file whose systems the source never stated', () => {
    // A source tarball says nothing about platforms. That is an artefact with
    // no systems, not a reason to hide the artefact.
    const grouped = groupDownloads([
      { plugin: PLUGIN, url: 'https://example.invalid/a-src.tar.gz', systems: '' }
    ])
    expect(grouped.get(PLUGIN)).toEqual([
      { url: 'https://example.invalid/a-src.tar.gz', systems: [] }
    ])
  })

  it('does not list the same artefact twice', () => {
    // One row per file, and a file in two packages is still one artefact.
    const grouped = groupDownloads([
      { plugin: PLUGIN, url: 'https://example.invalid/a.zip', systems: 'win' },
      { plugin: PLUGIN, url: 'https://example.invalid/a.zip', systems: 'win' }
    ])
    expect(grouped.get(PLUGIN)).toHaveLength(1)
  })

  it('skips rows with nothing to point at', () => {
    const grouped = groupDownloads([
      { plugin: PLUGIN, url: '', systems: 'win' },
      { plugin: '', url: 'https://example.invalid/a.zip', systems: 'win' },
      { plugin: PLUGIN, url: 'https://example.invalid/a.zip', systems: 'win' }
    ])
    expect(grouped.get(PLUGIN)).toHaveLength(1)
    expect(grouped.size).toBe(1)
  })

  it('groups nothing when the store holds nothing', () => {
    expect(groupDownloads([]).size).toBe(0)
    expect(groupDownloads(null).size).toBe(0)
  })
})

describe('labelling a download', () => {
  it('names the stated systems in platform order', () => {
    expect(downloadLabel({ url: 'https://example.invalid/a.zip', systems: ['mac', 'win'] }))
      .toBe('Download for Windows / MacOS')
  })

  it('says Download when the source stated nothing', () => {
    expect(downloadLabel({ url: 'https://example.invalid/a-src.tar.gz', systems: [] }))
      .toBe('Download')
    expect(downloadLabel({ url: 'https://example.invalid/a.zip' })).toBe('Download')
  })

  it('ignores a token the platform table does not know', () => {
    // Mapped through the same table the harvesters derive with, so a spelling
    // nothing recognises is dropped rather than displayed as a platform.
    expect(downloadLabel({ url: 'https://example.invalid/a.zip', systems: ['moddwarf'] }))
      .toBe('Download')
  })
})

describe('the downloads query', () => {
  it('loads with no placeholders to fill', () => {
    const sparql = new QueryService().get('plugin/downloads', {})
    expect(sparql).not.toContain('${')
  })

  it('names its graph, like every query must', () => {
    const sparql = new QueryService().get('plugin/downloads', {})
    expect(sparql).toMatch(/\bGRAPH\b/i)
  })

  it('selects the plugin, the URL and the systems together', () => {
    const sparql = new QueryService().get('plugin/downloads', {})
    expect(sparql).toContain('?plugin')
    expect(sparql).toContain('?url')
    expect(sparql).toContain('?systems')
    expect(sparql).toContain('pu:downloadUrl')
  })
})
