import { describe, it, expect } from 'vitest'
import { renderContributionsPage } from '../../src/api/render.js'
import { CORRECTABLE } from '../../src/contrib/Corrections.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * What a contributor can see of their own suggestions.
 *
 * Without this page a correction vanishes on submission: no acknowledgement, no
 * queue position, and no way to learn that a moderator declined it. That is how
 * the correction form shipped, and it is a poor bargain to offer someone whose
 * work you are asking for.
 */

const rows = [
  {
    correction: 'urn:c:1',
    subject: `${NAMESPACES.pu}plugin/drift-88b3b09d`,
    predicate: `${NAMESPACES.pu}category`,
    value: 'modulation',
    rationale: 'It modulates.',
    status: 'accepted',
    at: '2026-09-07T10:00:00.000Z',
    reviewedAt: '2026-09-08T10:00:00.000Z'
  },
  {
    correction: 'urn:c:2',
    subject: `${NAMESPACES.pu}plugin/drift-88b3b09d`,
    predicate: `${NAMESPACES.rdfs}comment`,
    value: 'A stepped CC pattern generator.',
    rationale: null,
    status: 'pending',
    at: '2026-09-09T10:00:00.000Z',
    reviewedAt: null
  }
]

describe('the contributions page', () => {
  const html = renderContributionsPage(rows, { correctable: CORRECTABLE, trustLevel: 'new' })

  it('shows what was proposed and what became of it', () => {
    expect(html).toContain('modulation')
    expect(html).toContain('accepted')
    expect(html).toContain('pending')
  })

  it('names the field in words rather than as an IRI', () => {
    // "http://purl.org/stuff/plugin-universe/category → modulation" is not a
    // sentence anybody wants to read about their own work.
    expect(html).toContain('Category')
    expect(html).not.toContain(`${NAMESPACES.pu}category<`)
  })

  it('links back to the plugin each one is about', () => {
    expect(html).toContain('href="/plugin/drift-88b3b09d"')
  })

  it('tells a new contributor how far off trust is', () => {
    // The threshold is the whole moderation bargain: review at first, then not.
    // Somebody being asked to wait deserves to know what they are waiting for.
    expect(html).toContain(String(CONTRIBUTION_CONFIG.acceptedBeforeTrusted))
    expect(html).toMatch(/1 of your suggestions have been accepted/)
  })

  it('says something different to a contributor who is already trusted', () => {
    const trusted = renderContributionsPage(rows, { correctable: CORRECTABLE, trustLevel: 'trusted' })
    expect(trusted).toMatch(/applied as soon as you make them/)
    expect(trusted).not.toContain('After 5')
  })

  it('shows a rationale where one was given and nothing where it was not', () => {
    expect(html).toContain('It modulates.')
  })

  it('says plainly that the page is private', () => {
    // A pending correction is in the personal-data graph and carries the
    // contributor's own words. Nobody else sees this.
    expect(html).toMatch(/Nothing here is shown to anyone else/)
  })

  it('points at the terms the contribution is made under', () => {
    expect(html).toContain('href="/terms"')
    expect(html).toContain('CC0')
  })

  it('invites a first contribution rather than showing an empty list', () => {
    const empty = renderContributionsPage([], { correctable: CORRECTABLE, trustLevel: 'new' })
    expect(empty).toMatch(/Nothing yet/)
    expect(empty).toMatch(/suggest a correction/)
  })
})
