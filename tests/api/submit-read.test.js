import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { renderSubmitPage } from '../../src/api/render.js'
import { SUBMITTABLE, withProfileVocabulary, loadSubmittable} from '../../src/contrib/Submissions.js'
import { draftFrom, PageReader } from '../../src/contrib/PageReader.js'
import { loadProfileVocabulary } from '../../src/rdf/ProfileVocabulary.js'

/**
 * "Read a page" on the submit form, and who may press it.
 *
 * `docs/sources.md` §4 rule 8 permits one fetch at a named person's request
 * and says what would turn it back into crawling. The last of the four is the
 * one that lives here rather than in `PageReader`: **a URL from anyone but a
 * moderator**. An open form is an open proxy, and "a person asked for it" stops
 * being true the moment anyone can ask.
 *
 * That gate exists in two places, which is the shape of this project's
 * recurring failure — the renderer decides whether to draw the box and the
 * route decides whether to act on it. Only the second is a control. Both are
 * checked below, and so is the fact that there are two.
 */

const PAGE = `<html><head><title>Dragonfly Reverb</title>
<script type="application/ld+json">{"@type":"SoftwareApplication",
 "name":"Dragonfly Reverb","author":{"name":"Michael Willis"},"license":"MIT"}</script>
</head><body><p>Builds for VST3 and LV2.</p></body></html>`

const draftOf = () => ({
  ...draftFrom(PAGE, 'https://example.org/df/'),
  url: 'https://example.org/df/'
})

/**
 * The field table as the server builds it: choices filled from
 * `vocabs/trn-profile.ttl` rather than copied into JavaScript. The bare
 * SUBMITTABLE has `choices: null` on the profile fields deliberately, and the
 * renderer refuses to draw a multi-choice group with nothing to tick — so a
 * test that renders the form has to fill it exactly as `bin/serve.js` does.
 */
const FIELDS = await loadSubmittable()

const page = extra => renderSubmitPage(FIELDS, { csrfToken: 't', ...extra })

describe('who is offered the URL box', () => {
  it('shows it to a moderator', () => {
    expect(page({ mayRead: true })).toContain('Read a page or profile instead')
  })

  it('does not show it to anyone else', () => {
    expect(page({ mayRead: false })).not.toContain('Read a page or profile instead')
    // The default is closed: a caller that forgets to pass mayRead gets the
    // ordinary form, not the privileged one.
    expect(page({})).not.toContain('Read a page or profile instead')
  })

  it('leaves the ordinary form exactly as it was', () => {
    // Everyone else's experience of /submit must not change.
    const before = page({ mayRead: false })
    for (const [, spec] of Object.entries(SUBMITTABLE)) {
      // Except the picture, which is drawn only for somebody trusted to upload.
      if (spec.upload) continue
      expect(before).toContain(spec.label)
    }
    expect(before).toContain('Submit plugin')
  })
})

describe('what a draft looks like on the page', () => {
  it('fills the fields in rather than describing them', () => {
    const draft = draftOf()
    const html = page({ mayRead: true, draft, values: draft.fields })
    expect(html).toMatch(/value="Dragonfly Reverb"/)
    expect(html).toMatch(/value="LV2" checked/)
    expect(html).toMatch(/value="VST3" checked/)
  })

  it('says where each field came from', () => {
    const draft = draftOf()
    const html = page({ mayRead: true, draft, values: draft.fields })
    expect(html).toContain('Drafted from')
    expect(html).toContain('schema.org name')
    // The label, not the internal key: this is read by a person.
    expect(html).toContain('<strong>Name</strong>')
  })

  it('still requires the ordinary Submit button', () => {
    // The fetch drafts; it does not save. If reading a page wrote anything,
    // rule 8's "the result is a draft for a human to check" would be false.
    const draft = draftOf()
    const html = page({ mayRead: true, draft, values: draft.fields })
    expect(html).toContain('Submit plugin')
    expect(html).toContain('action="/submit"')
  })

  it('shows nothing at all when there is no draft', () => {
    expect(page({ mayRead: true })).not.toContain('Drafted from')
  })

  it('keeps the pasted URL in the box after a refusal', () => {
    // A box that empties itself when it refuses is a box people fill once.
    const html = page({ mayRead: true, pageUrl: 'https://example.org/typo', error: 'No such host' })
    expect(html).toContain('https://example.org/typo')
  })
})

describe('the gate is a control, not a hidden button', () => {
  /**
   * The route source, wherever it lives.
   *
   * This named `src/api/server.js` until the submission routes moved to
   * `src/contrib/routes.js`, at which point all three of these went red — the
   * good outcome, and only because they assert on *content* rather than on a
   * slice that would have quietly matched nothing. Walking `src/` is what the
   * guards that survived the move do, so these do it too.
   */
  const server = (() => {
    const files = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) files.push(full)
      }
    }
    walk('src')
    return files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
  })()

  it('refuses a read that arrives without the form having been drawn', () => {
    // Hiding the form is a decision about a page. Somebody can still POST
    // read=1, so the route checks trust itself.
    const branch = server.slice(server.indexOf("if (form.get('read'))"))
    const body = branch.slice(0, branch.indexOf('\n  }\n'))
    expect(body, 'the read branch was not found at all').not.toBe('')
    expect(body).toContain('mayRead')
    expect(body).toMatch(/403/)
  })

  it('derives both gates from the same condition', () => {
    // One `mayRead`, computed once and passed to the renderer — rather than the
    // route testing trust and the template testing something that drifts from
    // it. This project has been caught by two lists that had to agree five
    // times; one variable cannot disagree with itself.
    expect(server).toMatch(/const mayRead = account\.trustLevel === TRUST\.MODERATOR/)
    expect(server).toMatch(/mayRead,/)
  })

  it('reads exactly one page per request', () => {
    // No loop, no link-following: the whole of the network activity is one
    // call. If a second appears here, rule 8 has been broken in the route
    // rather than in PageReader, where the other three refusals live.
    const reader = fs.readFileSync('src/contrib/PageReader.js', 'utf8')
    expect(reader.match(/fetchText\(/g) ?? []).toHaveLength(1)
    expect(server.match(/pageReader\.read\(/g) ?? []).toHaveLength(1)
  })
})

/**
 * Reading an address that turns out to be a profile.
 *
 * "Read a page" became "Read a page or profile", so the same one fetch now
 * answers with either — and the choice is made from the body rather than from
 * `Content-Type`. That looks like the obvious mechanism and is the wrong one:
 * static hosts serve `.ttl` as `text/plain`, GitHub's raw view serves
 * everything as `text/plain`, and an author told to publish a profile is very
 * likely to put it on exactly those.
 */
describe('telling a page from a profile', () => {
  const PROFILE = `@prefix trn: <http://purl.org/stuff/transmissions/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://93.184.216.34/df/> a trn:PluginProfile ;
  rdfs:label "Dragonfly Reverb" ; trn:vendor "Michael Willis" ;
  foaf:homepage <https://93.184.216.34/df/> ; trn:format trn:LV2 .`

  // A bare IP, not a hostname. `read()` vets the address first, and
  // `dns.lookup` resolves a numeric address without asking the network — which
  // is why every address in `PageReader.test.js` is one too. A hostname here
  // would put a DNS query in the core suite, which is supposed to need no
  // services at all.
  /** A reader whose one fetch returns whatever this test says it does. */
  const readerFor = body => new PageReader({
    http: { fetchText: async () => body }
  })

  it('reads a profile served as plain text, which is how most hosts serve one', async () => {
    const draft = await readerFor(PROFILE).read('https://93.184.216.34/df/profile.ttl')
    expect(draft.kind).toBe('profile')
    expect(draft.fields.name).toBe('Dragonfly Reverb')
    expect(draft.fields.format).toEqual(['LV2'])
  })

  it('still reads an HTML page as a page', async () => {
    const draft = await readerFor(PAGE).read('https://93.184.216.34/df/')
    expect(draft.kind).toBe('page')
    expect(draft.fields.name).toBe('Dragonfly Reverb')
  })

  it('reads a page that opens with a comment rather than a doctype', async () => {
    // Recognition is positive — `<html`, `<head` or `<body` anywhere in the
    // opening kilobyte — because a Turtle file has no comparable marker: it may
    // open with a comment, a @prefix, a @base, or straight into a subject IRI.
    const draft = await readerFor(`<!-- built by hand -->\n${PAGE}`).read('https://93.184.216.34/df/')
    expect(draft.kind).toBe('page')
  })

  it('reads a profile that opens with comments, not a prefix', async () => {
    const draft = await readerFor(`# a profile\n# hosted by its author\n${PROFILE}`)
      .read('https://93.184.216.34/df/p.ttl')
    expect(draft.kind).toBe('profile')
  })

  it('reads JSON-LD served at a URL', async () => {
    const jsonld = JSON.stringify({
      '@context': { trn: 'http://purl.org/stuff/transmissions/', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' },
      '@id': 'https://93.184.216.34/df/', '@type': 'trn:PluginProfile', 'rdfs:label': 'Dragonfly Reverb'
    })
    const draft = await readerFor(jsonld).read('https://93.184.216.34/df/profile.jsonld')
    expect(draft.kind).toBe('profile')
    expect(draft.format).toBe('JSON-LD')
  })

  it('says it is a broken profile, not a page with no title', async () => {
    // Reporting a parse failure as a page whose metadata was thin would hide
    // the real reason from whoever has to fix the file.
    await expect(readerFor('@prefix trn: <http://x/> .\n<a> trn:b')
      .read('https://93.184.216.34/df/p.ttl')).rejects.toThrow(/not a page, and.*parse/)
  })

  it('asks for both, so a server that negotiates can offer the profile', async () => {
    let asked = null
    const reader = new PageReader({
      http: { fetchText: async (url, options) => { asked = options.accept; return PROFILE } }
    })
    await reader.read('https://93.184.216.34/df/')
    expect(asked).toContain('text/turtle')
    expect(asked).toContain('application/ld+json')
    expect(asked).toContain('text/html')
  })

  it('still makes exactly one request, whichever branch it takes', async () => {
    // The bound docs/sources.md §4 rule 8 actually sets. Two content types must
    // not become two fetches.
    let calls = 0
    const reader = new PageReader({
      http: { fetchText: async () => { calls++; return PROFILE } }
    })
    await reader.read('https://93.184.216.34/df/profile.ttl')
    expect(calls).toBe(1)
  })
})

/**
 * "Fetch a Jig plugin or collection" on the same form, for anybody signed in.
 *
 * A different box from the moderator's above it, for a different reason: this
 * one reads no prose, so there is no judgement to exercise — a plugin's own
 * address serves its profile and a collection names its members. The moderate
 * gate stays exactly where it was; this box has none beyond being signed in,
 * which the route already requires before any branch runs.
 */
describe('who is offered the Jig box', () => {
  it('offers Jig as a format on the ordinary form', () => {
    // The binding a reader sees: a JigDAW author told to pick their format
    // must find one to pick.
    expect(page({})).toContain('value="Jig"')
  })

  it('shows the fetch box when asked, and hides it by default', () => {
    expect(page({ mayFetchJig: true })).toContain('Fetch a Jig plugin or collection instead')
    expect(page({})).not.toContain('Fetch a Jig plugin or collection instead')
  })

  it('shows both boxes to a moderator without merging them', () => {
    const html = page({ mayRead: true, mayFetchJig: true })
    expect(html).toContain('Read a page or profile instead')
    expect(html).toContain('Fetch a Jig plugin or collection instead')
  })

  it('keeps the pasted address in the box after a refusal', () => {
    const html = page({
      mayFetchJig: true,
      jigUrl: 'https://93.184.216.34/collections/two.ttl',
      error: 'That does not parse as Turtle: boom'
    })
    expect(html).toContain('https://93.184.216.34/collections/two.ttl')
  })
})

describe('what a fetched collection looks like on the page', () => {
  const result = jigResult => page({ mayFetchJig: true, jigResult })

  it('lists members, drafting the new ones and linking the rest', () => {
    const html = result({
      collection: { label: 'Two plugins', url: 'https://93.184.216.34/c.ttl', comment: '' },
      members: [
        { state: 'new', url: 'https://93.184.216.34/plugins/a/', name: 'Alpha' },
        { state: 'catalogued', url: 'https://93.184.216.34/plugins/b/', name: 'Beta', href: '/plugin/beta-12345678' },
        { state: 'pending', url: 'https://93.184.216.34/plugins/c/', name: 'Gamma' },
        { state: 'failed', url: 'https://93.184.216.34/plugins/d/', name: 'Delta', error: 'Could not read it: gone.' }
      ]
    })
    expect(html).toContain('Two plugins')
    expect(html).toContain('Draft this one')
    expect(html).toContain('/plugin/beta-12345678')
    expect(html).toContain('waiting for review')
    expect(html).toContain('Could not read it: gone.')
  })

  it('shows nothing at all when no collection was fetched', () => {
    expect(page({ mayFetchJig: true })).not.toContain('Draft this one')
  })
})

describe('the bounds around fetching by URL', () => {
  const server = (() => {
    const files = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) files.push(full)
      }
    }
    walk('src')
    return files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
  })()

  it('still reads exactly one page per moderator request', () => {
    // Unchanged by the Jig box beside it: the page reader's bound is one
    // fetch, and the route calls it once.
    const reader = fs.readFileSync('src/contrib/PageReader.js', 'utf8')
    expect(reader.match(/fetchText\(/g) ?? []).toHaveLength(1)
    expect(server.match(/pageReader\.read\(/g) ?? []).toHaveLength(1)
  })

  it('reads one Jig address per request, members bounded and counted', async () => {
    // A collection is one plus N fetches rather than one, so "one request"
    // cannot be the bound — the member cap is. It lives in the contribution
    // config beside every other bound, and the reader honours it by default.
    expect(server.match(/jigReader\.read\(/g) ?? []).toHaveLength(1)
    const { JigReader } = await import('../../src/contrib/JigReader.js')
    const { CONTRIBUTION_CONFIG } = await import('../../config/preferences.js')
    expect(new JigReader({ http: { fetchText: async () => '' } }).maxMembers)
      .toBe(CONTRIBUTION_CONFIG.jigCollectionMembers)
  })
})
