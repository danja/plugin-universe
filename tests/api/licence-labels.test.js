import { describe, it, expect } from 'vitest'
import { renderPluginPage } from '../../src/api/render.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * What a reader is told about a licence the catalogue could not fully pin down.
 *
 * Two values on the plugin page are not SPDX identifiers and would be read as
 * if they were. `GPL` beside `GPL-3.0` looks like a truncation — it is 59
 * plugins whose DOAP licence URL names the family and not the version, which
 * the catalogue records rather than guessing at. `NOASSERTION` is SPDX's own
 * word for "there is a licence and we did not identify it", which is not a
 * phrase anyone should have to go and look up.
 *
 * The stored value is unchanged either way: the facet still groups on `GPL`.
 * This is the label only.
 */

const doc = licenceId => ({
  iri: `${NAMESPACES.pu}plugin/test-00000000`,
  name: 'Test',
  licenceId
})

describe('licence labels on a plugin page', () => {
  it('says when a version was not stated', () => {
    const page = renderPluginPage(doc('GPL'))
    expect(page).toContain('GPL (version not stated)')
  })

  it('leaves a full identifier exactly as it is', () => {
    expect(renderPluginPage(doc('GPL-3.0'))).toContain('GPL-3.0')
    expect(renderPluginPage(doc('GPL-3.0'))).not.toContain('version not stated')
  })

  it('spells out NOASSERTION rather than printing it', () => {
    const page = renderPluginPage(doc('NOASSERTION'))
    expect(page).toContain('stated, but not identified')
    expect(page).not.toContain('NOASSERTION')
  })

  it('shows no licence row at all when nothing is known', () => {
    expect(renderPluginPage(doc(null))).not.toContain('Licence')
  })
})
