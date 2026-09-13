import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { validate, FeedbackError, FEEDBACK_STATUS } from '../../src/contrib/Feedback.js'
import { renderFeedbackPage, renderAdminPage } from '../../src/api/render.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { ACTIONS } from '../../src/api/AdminActions.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A message to the moderators.
 *
 * The thing worth testing hardest here is not the form — it is **where a
 * message is stored**. Everything else a person can write on this site is a
 * contribution, and every contribution lands in a graph with a publication
 * licence on it: CC0 for facts, CC BY-SA for prose. Somebody writing in to say
 * the search is confusing has agreed to neither, and a dump that published
 * their message would be a breach rather than a bug.
 *
 * So the licence flag is asserted here, and the round trip through a real store
 * is in `tests/store/feedback.test.js`.
 */

const VIEWER = {
  account: { iri: `${NAMESPACES.pu}person/someone-00000000`, login: 'someone', trustLevel: 'new' },
  signInEnabled: true
}

describe('what may be sent', () => {
  it('refuses an empty message', () => {
    expect(() => validate({ message: '' })).toThrow(FeedbackError)
    expect(() => validate({ message: '   \n  ' })).toThrow(FeedbackError)
    expect(() => validate({})).toThrow(FeedbackError)
  })

  it('trims, so whitespace is not a message', () => {
    expect(validate({ message: '  hello  ' }).message).toBe('hello')
  })

  it('refuses one longer than the limit, and says so in characters', () => {
    const tooLong = 'x'.repeat(CONTRIBUTION_CONFIG.maxFeedbackLength + 1)
    expect(() => validate({ message: tooLong })).toThrow(/4000 characters/)
    expect(validate({ message: 'x'.repeat(CONTRIBUTION_CONFIG.maxFeedbackLength) }).message)
      .toHaveLength(CONTRIBUTION_CONFIG.maxFeedbackLength)
  })

  it('has only two states, and neither is "accepted"', () => {
    // A correction is accepted or rejected because it proposes a change that
    // can be applied. A message proposes nothing, so the only question is
    // whether somebody has dealt with it.
    expect(Object.values(FEEDBACK_STATUS).sort()).toEqual(['new', 'read'])
  })
})

describe('where a message is stored, which is the whole of the difference', () => {
  const source = readFileSync('src/contrib/Feedback.js', 'utf8')

  it('registers its graph as personal data, not as a contribution licence', () => {
    // `personal-data` is flagged non-redistributable in GraphRegistry, so the
    // dump excludes it by the same query that excludes a proprietary source.
    // CC0 or CC-BY-SA here would publish private mail on the next dump and
    // nothing would have complained.
    expect(source).toMatch(/licence:\s*'personal-data'/)
    expect(source).not.toMatch(/licence:\s*'CC0-1\.0'/)
    expect(source).not.toMatch(/licence:\s*'CC-BY-SA-4\.0'/)
  })

  it('does not go anywhere near the contributor graphs', () => {
    // The helper every *contribution* writes through. A message must not touch
    // it: those two graphs are the published ones.
    expect(source).not.toContain('ContributorGraphs')
    expect(source).not.toContain('ensureContributorGraphs')
  })

  it('keeps its own graph, separate from the correction queue', async () => {
    // Both are personal data, but erasing somebody's messages and erasing their
    // pending corrections are different requests, and a graph is the unit
    // either one is answered in.
    const { LICENCES } = await import('../../src/store/GraphRegistry.js')
    expect(LICENCES['personal-data'].redistributable).toBe(false)
    expect(LICENCES['personal-data'].cc0Dump).toBe(false)
    expect(source).toMatch(/graphId = 'feedback'/)
  })
})

describe('the form', () => {
  const page = extra => renderFeedbackPage({ csrfToken: 't', viewer: VIEWER, ...extra })

  it('says the message is not published, because that is the question', () => {
    const html = page({})
    expect(html).toContain('not published')
    expect(html).toContain('moderation queue')
  })

  it('says the moderators cannot reply here', () => {
    // The one thing a person writing in most needs to know, and the thing a
    // form that only says "thanks" gets wrong.
    expect(page({})).toMatch(/no way to reply/i)
    expect(page({ sent: true })).toMatch(/no reply on the site/i)
  })

  it('hands a refused message back rather than losing it', () => {
    const html = page({ error: 'Too long.', message: 'three paragraphs of prose' })
    expect(html).toContain('three paragraphs of prose')
    expect(html).toContain('Too long.')
  })

  it('empties the box once it has been sent', () => {
    // Otherwise a reload looks like an unsent draft, and the message gets sent
    // twice by somebody being careful.
    const html = page({ sent: true, message: 'already gone' })
    expect(html).not.toContain('already gone')
  })

  it('carries the length limit into the markup, from the one place it is set', () => {
    expect(page({})).toContain(`maxlength="${CONTRIBUTION_CONFIG.maxFeedbackLength}"`)
  })
})

describe('the moderator sees it', () => {
  const admin = feedback => renderAdminPage([], {
    csrfToken: 't', viewer: VIEWER, actions: ACTIONS, feedback
  })

  it('shows a message, who sent it and when', () => {
    const html = admin([{
      iri: `${NAMESPACES.pu}feedback/x-00000000`,
      message: 'The category page is confusing.',
      by: VIEWER.account.iri,
      login: 'someone',
      at: '2026-09-13T11:22:33Z'
    }])
    expect(html).toContain('The category page is confusing.')
    expect(html).toContain('someone')
    expect(html).toContain('2026-09-13 11:22')
    expect(html).toContain('1 unread message')
  })

  it('escapes it, because this is a stranger writing to an administrator', () => {
    // The one place on the site where free text from anyone reaches an
    // admin screen. Rendered as text, never as markup.
    const html = admin([{
      iri: 'urn:x', message: '<script>alert(1)</script>', by: 'urn:y', login: 'x', at: '2026-09-13'
    }])
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('offers only "mark read" — there is nothing to accept', () => {
    const html = admin([{ iri: 'urn:x', message: 'hi', by: 'urn:y', login: 'x', at: '2026-09-13' }])
    expect(html).toContain('markread')
    expect(html).not.toMatch(/name="decision"[^>]*value="accept"[^>]*feedback/)
  })

  it('shows nothing at all when feedback is not configured', () => {
    // Like the promotion and claim panels: a control for something the instance
    // cannot do is a puzzle.
    expect(admin(null)).not.toContain('Messages')
  })

  it('says so plainly when there is nothing unread', () => {
    expect(admin([])).toContain('Nothing unread')
  })
})
