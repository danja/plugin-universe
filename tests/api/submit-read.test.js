import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { renderSubmitPage } from '../../src/api/render.js'
import { SUBMITTABLE } from '../../src/contrib/Submissions.js'
import { draftFrom } from '../../src/contrib/PageReader.js'

/**
 * "Read a page" on the submit form, and who may press it.
 *
 * `docs/resources.md` §4 rule 8 permits one fetch at a named person's request
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

const page = extra => renderSubmitPage(SUBMITTABLE, { csrfToken: 't', ...extra })

describe('who is offered the URL box', () => {
  it('shows it to a moderator', () => {
    expect(page({ mayRead: true })).toContain('Read a page instead')
  })

  it('does not show it to anyone else', () => {
    expect(page({ mayRead: false })).not.toContain('Read a page instead')
    // The default is closed: a caller that forgets to pass mayRead gets the
    // ordinary form, not the privileged one.
    expect(page({})).not.toContain('Read a page instead')
  })

  it('leaves the ordinary form exactly as it was', () => {
    // Everyone else's experience of /submit must not change.
    const before = page({ mayRead: false })
    for (const spec of Object.values(SUBMITTABLE)) {
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
  const server = fs.readFileSync('src/api/server.js', 'utf8')

  it('refuses a read that arrives without the form having been drawn', () => {
    // Hiding the form is a decision about a page. Somebody can still POST
    // read=1, so the route checks trust itself.
    const branch = server.slice(server.indexOf("if (form.get('read'))"))
    const body = branch.slice(0, branch.indexOf('\n          }\n'))
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
