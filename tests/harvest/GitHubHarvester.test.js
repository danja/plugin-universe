import { describe, it, expect, beforeAll } from 'vitest'
import GitHubHarvester, { graphIdFor } from '../../src/harvest/GitHubHarvester.js'
import GitHubDiscovery, { shouldInclude } from '../../src/harvest/GitHubDiscovery.js'
import GraphRegistry, { LICENCES } from '../../src/store/GraphRegistry.js'
import { HarvestError } from '../../src/harvest/Harvester.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const trn = NAMESPACES.trn

/**
 * The GitHub harvester is tested against a stand-in for the API rather than the
 * API itself. That is a deliberate exception to the project's no-mocking rule,
 * and the reason is not convenience: a test suite that calls GitHub on every
 * run is a test suite that costs someone else's rate limit to run, which is the
 * opposite of the operating principle this harvester exists to honour.
 *
 * What is faked is the transport, which has no logic in it. The interpretation
 * — bundle grouping, licence mapping, LV2 reading — is the real code, and the
 * LV2 reading is the same module the disk harvester uses and the disk harvester
 * is tested against 36 real bundles.
 */

const MANIFEST = `
@prefix lv2:  <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<https://example.invalid/plugins/warble> a lv2:Plugin ; rdfs:seeAlso <warble.ttl> .
`

const PLUGIN_TTL = `
@prefix lv2:   <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix doap:  <http://usefulinc.com/ns/doap#> .
@prefix foaf:  <http://xmlns.com/foaf/0.1/> .
@prefix units: <http://lv2plug.in/ns/extensions/units#> .

<https://example.invalid/plugins/warble>
    a lv2:Plugin , lv2:ModulatorPlugin ;
    doap:name "Warble" ;
    doap:maintainer [ foaf:name "Ada Example" ] ;
    rdfs:comment "A chorus with a slow drift." ;
    lv2:port [
        a lv2:InputPort , lv2:ControlPort ;
        lv2:symbol "rate" ;
        lv2:name "Rate" ;
        lv2:minimum 0.01 ;
        lv2:maximum 8.0 ;
        lv2:default 0.5 ;
        units:unit units:hz ;
    ] , [
        a lv2:InputPort , lv2:AudioPort ;
        lv2:symbol "in" ;
        lv2:name "In" ;
    ] .
`

/** A GitHubClient stand-in: canned responses, and a record of what was asked. */
class FakeClient {
  constructor ({ repo, tree, files, releases = [] }) {
    this.repoBody = repo
    this.treeBody = tree
    this.files = files
    this.releases = releases
    this.calls = []
    this.rateLimit = { used: 0, remaining: 5000, limit: 5000, resetAt: null }
  }

  async get (path, { allowMissing = false } = {}) {
    this.calls.push(path)
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return this.repoBody
    if (path.includes('/git/trees/')) return this.treeBody
    if (allowMissing) return null
    throw new Error(`unexpected GET ${path}`)
  }

  async paginate (path) {
    this.calls.push(path)
    if (path.includes('/releases')) return this.releases
    return []
  }

  async tree (owner, repo, ref) {
    this.calls.push(`tree:${ref}`)
    return this.treeBody
  }

  async fileText (owner, repo, filePath) {
    this.calls.push(`file:${filePath}`)
    return this.files[filePath] ?? null
  }
}

function fakeRepo (overrides = {}) {
  return new FakeClient({
    repo: {
      full_name: 'ada/warble-lv2',
      description: 'Chorus plugins for LV2',
      homepage: '',
      html_url: 'https://github.com/ada/warble-lv2',
      owner: { login: 'ada' },
      license: { spdx_id: 'GPL-3.0' },
      topics: ['lv2', 'chorus'],
      archived: false,
      default_branch: 'main',
      stargazers_count: 12,
      pushed_at: '2026-08-01T00:00:00Z',
      ...overrides.repo
    },
    tree: overrides.tree ?? {
      paths: [
        'README.md',
        'plugins/warble.lv2/manifest.ttl',
        'plugins/warble.lv2/warble.ttl',
        'build/plugins/warble.lv2/manifest.ttl',
        'build/plugins/warble.lv2/warble.ttl'
      ],
      truncated: false
    },
    files: overrides.files ?? {
      'plugins/warble.lv2/manifest.ttl': MANIFEST,
      'plugins/warble.lv2/warble.ttl': PLUGIN_TTL
    },
    releases: overrides.releases ?? []
  })
}

describe('graph identity', () => {
  it('gives each repository its own graph, so each carries its own licence', () => {
    expect(graphIdFor('ada', 'warble-lv2')).toBe('github-ada-warble-lv2')
    // The registry's id rule must accept whatever this produces.
    expect(() => GraphRegistry.graphIri('source', graphIdFor('Ada.X', 'Warble_LV2'))).not.toThrow()
  })

  it('normalises case and punctuation', () => {
    expect(graphIdFor('DISTRHO', 'Mini-Series')).toBe('github-distrho-mini-series')
  })
})

describe('describe()', () => {
  it('reads the licence from the API rather than guessing it', async () => {
    const client = fakeRepo()
    const info = await GitHubHarvester.describe('ada', 'warble-lv2', client)
    expect(info.licence).toBe('GPL-3.0')
    expect(info.spdxId).toBe('GPL-3.0')
    expect(LICENCES['GPL-3.0'].cc0Dump).toBe(false)
  })

  it('maps an unstated or unrecognised licence to unknown, not to something convenient', async () => {
    for (const spdx of [null, 'NOASSERTION', 'WTFPL']) {
      const client = fakeRepo({ repo: { license: spdx ? { spdx_id: spdx } : null } })
      const info = await GitHubHarvester.describe('ada', 'warble-lv2', client)
      expect(info.licence).toBe('unknown')
    }
  })

  it('reports a missing repository as absent rather than throwing', async () => {
    const client = { get: async () => null }
    expect(await GitHubHarvester.describe('ada', 'gone', client)).toBeNull()
  })
})

describe('bundle discovery', () => {
  it('groups Turtle files by their .lv2 directory', () => {
    const bundles = GitHubHarvester.bundlesFrom([
      'a/one.lv2/manifest.ttl', 'a/one.lv2/one.ttl', 'b/two.lv2/manifest.ttl', 'README.md'
    ])
    expect([...bundles.keys()].sort()).toEqual(['a/one.lv2', 'b/two.lv2'])
    expect(bundles.get('a/one.lv2')).toHaveLength(2)
  })

  it('skips build, staging and release copies', () => {
    const bundles = GitHubHarvester.bundlesFrom([
      'plugins/x.lv2/manifest.ttl',
      'build/plugins/x.lv2/manifest.ttl',
      'releases/x.lv2/manifest.ttl',
      'dist/x.lv2/manifest.ttl'
    ])
    expect([...bundles.keys()]).toEqual(['plugins/x.lv2'])
  })

  it('ignores Turtle that is not in a bundle', () => {
    expect(GitHubHarvester.bundlesFrom(['vocab/ontology.ttl', 'doc/example.ttl']).size).toBe(0)
  })
})

describe('GitHubHarvester', () => {
  let result
  let client
  beforeAll(async () => {
    client = fakeRepo()
    result = await new GitHubHarvester({
      owner: 'ada', repo: 'warble-lv2', licence: 'GPL-3.0', client
    }).harvest()
  })

  it('needs a licence, like every harvester', () => {
    expect(() => new GitHubHarvester({ owner: 'a', repo: 'b', client: fakeRepo() })).toThrow(HarvestError)
  })

  it('reads the plugin out of the bundle', () => {
    expect(result.rejected).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].name).toBe('Warble')
    expect(result.plugins[0].formats).toEqual([`${trn}LV2`])
  })

  it('reads ports with no translation, as LV2 intends', () => {
    const rate = result.plugins[0].parameters.find(p => p.symbol === 'rate')
    expect(rate.minimum).toBe(0.01)
    expect(rate.maximum).toBe(8)
    expect(rate.unitIri).toBe(`${NAMESPACES.units}hz`)
    // Audio ports are connectivity, not parameters.
    expect(result.plugins[0].parameters.some(p => p.symbol === 'in')).toBe(false)
    expect(result.plugins[0].accepts).toContain(`${trn}Audio`)
  })

  it('maps the LV2 class into the category scheme', () => {
    expect(result.plugins[0].categories).toContain('modulation')
    expect(result.plugins[0].categories).toContain('effect')
  })

  it('preserves the plugin\'s own canonical IRI', () => {
    expect(result.plugins[0].sourceIri).toBe('https://example.invalid/plugins/warble')
  })

  it('takes the maintainer from the bundle, and the topics from the repository', () => {
    expect(result.plugins[0].vendor).toBe('Ada Example')
    expect(result.plugins[0].tags).toEqual(['chorus', 'lv2'])
  })

  it('does not fetch build copies of the same bundle', () => {
    expect(client.calls.filter(call => call.startsWith('file:build/'))).toEqual([])
  })

  it('never calls an endpoint that would expose an email address', () => {
    // Commits, contributors and users all carry them. None is asked for.
    expect(client.calls.some(call => /\/(commits|contributors|users|emails)/.test(call))).toBe(false)
  })
})

describe('release attribution', () => {
  const release = [{
    tag_name: 'v1.2.0',
    published_at: '2026-07-01T00:00:00Z',
    name: 'v1.2.0',
    draft: false,
    prerelease: false,
    assets: [{ browser_download_url: 'https://example.invalid/warble.zip', size: 1024, download_count: 7 }]
  }]

  it('attaches release assets when the repository holds exactly one plugin', async () => {
    const client = fakeRepo({ releases: release })
    const { plugins } = await new GitHubHarvester({
      owner: 'ada', repo: 'warble-lv2', licence: 'GPL-3.0', client
    }).harvest()
    expect(plugins[0].packages).toHaveLength(1)
    expect(plugins[0].packages[0].version).toBe('v1.2.0')
    // The API publishes no checksum for a release asset. An absent one is
    // honest; a fabricated one is not.
    expect(plugins[0].packages[0].files[0].sha256).toBeNull()
  })

  it('declines to attribute an asset when the repository holds several plugins', async () => {
    const second = PLUGIN_TTL
      .replaceAll('plugins/warble', 'plugins/wobble')
      .replace('"Warble"', '"Wobble"')
    const client = fakeRepo({
      releases: release,
      tree: {
        paths: ['a/warble.lv2/warble.ttl', 'b/wobble.lv2/wobble.ttl'],
        truncated: false
      },
      files: { 'a/warble.lv2/warble.ttl': PLUGIN_TTL, 'b/wobble.lv2/wobble.ttl': second }
    })
    const harvester = new GitHubHarvester({ owner: 'ada', repo: 'warble-lv2', licence: 'GPL-3.0', client })
    const { plugins } = await harvester.harvest()
    expect(plugins).toHaveLength(2)
    expect(plugins.every(p => p.packages.length === 0)).toBe(true)
    expect(harvester.notes.join(' ')).toMatch(/not attributed/)
  })

  it('reads a bundle whose sibling file is an unparseable build template', async () => {
    // master_me keeps a template under pregen/ whose manifest contains
    // `ui:@uitype@UI` — substituted at build time, not Turtle until then.
    // Rejecting the bundle over it threw away the plugin beside it, and the
    // whole repository harvested to nothing.
    const client = fakeRepo({
      tree: {
        paths: ['p/warble.lv2/manifest.ttl', 'p/warble.lv2/warble.ttl'],
        truncated: false
      },
      files: {
        'p/warble.lv2/manifest.ttl': '@prefix ui: <http://lv2plug.in/ns/extensions/ui#> .\n<x> a ui:@uitype@UI .',
        'p/warble.lv2/warble.ttl': PLUGIN_TTL
      }
    })
    const harvester = new GitHubHarvester({ owner: 'ada', repo: 'warble-lv2', licence: 'GPL-3.0', client })
    const { plugins, rejected } = await harvester.harvest()
    expect(plugins).toHaveLength(1)
    expect(plugins[0].name).toBe('Warble')
    expect(rejected).toEqual([])
    expect(harvester.notes.join(' ')).toMatch(/build template/)
  })

  it('reports a bundle in which nothing parsed, rather than passing it off as empty', async () => {
    const client = fakeRepo({
      tree: { paths: ['p/broken.lv2/manifest.ttl'], truncated: false },
      files: { 'p/broken.lv2/manifest.ttl': 'this is not turtle at all {{{' }
    })
    const harvester = new GitHubHarvester({ owner: 'ada', repo: 'broken', licence: 'MIT', client })
    const { plugins, rejected } = await harvester.harvest()
    expect(plugins).toHaveLength(0)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].name).toBe('p/broken.lv2')
  })

  it('reports a truncated tree instead of silently losing bundles', async () => {
    const client = fakeRepo({
      tree: { paths: ['plugins/warble.lv2/warble.ttl'], truncated: true }
    })
    const harvester = new GitHubHarvester({ owner: 'ada', repo: 'warble-lv2', licence: 'GPL-3.0', client })
    await harvester.harvest()
    expect(harvester.notes.join(' ')).toMatch(/truncated/)
  })

  it('refuses a repository that would cost more requests than the limit allows', async () => {
    const paths = Array.from({ length: 100 }, (unused, i) => `p/x${i}.lv2/x.ttl`)
    const client = fakeRepo({ tree: { paths, truncated: false } })
    const harvester = new GitHubHarvester({
      owner: 'ada', repo: 'big', licence: 'MIT', client, maxBundleFiles: 10
    })
    await expect(harvester.collect()).rejects.toThrow(/above the 10 limit/)
  })
})

describe('discovery decides nothing on its own', () => {
  const row = extra => ({ licence: 'MIT', archived: false, ...extra })

  it('includes a repository with a recognised, redistributable licence', () => {
    expect(shouldInclude(row())).toBe(true)
  })

  it('excludes an unlicensed repository, because silence is not permission', () => {
    expect(shouldInclude(row({ licence: 'unknown' }))).toBe(false)
  })

  it('excludes an archived repository by default', () => {
    expect(shouldInclude(row({ archived: true }))).toBe(false)
  })

  it('turns a search result into a reviewable row', () => {
    const candidate = GitHubDiscovery.toCandidate({
      full_name: 'ada/warble-lv2',
      description: 'Chorus',
      license: { spdx_id: 'GPL-3.0' },
      topics: ['lv2'],
      stargazers_count: 12,
      archived: false,
      pushed_at: '2026-08-01T00:00:00Z'
    })
    expect(candidate).toMatchObject({
      owner: 'ada',
      repo: 'warble-lv2',
      licence: 'GPL-3.0',
      graph: 'graph:source/github-ada-warble-lv2',
      include: true
    })
  })
})
