import { describe, it, expect } from 'vitest'
import { healthProblems, healthStatus } from '../../src/api/meta-routes.js'
import { existsSync, readFileSync } from 'fs'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * What `/health` is for.
 *
 * It reported `plugins` and `index` side by side and asserted nothing about
 * them — two numbers and no claim that they agree. A plugin can reach the
 * catalogue and not the vector index, because `takeUpNewPlugins` allows that
 * deliberately: refusing a whole submission over a failed embedding would be
 * worse than accepting a plugin that is findable by name today and by meaning
 * tomorrow. The cost was that the failure was reported nowhere but a log line,
 * and the symptom — a plugin missing from semantic search — looks exactly like
 * a plugin that does not match the query.
 *
 * The case worth testing is the one a healthy instance cannot show. A check
 * that has only ever run against a correct store is a check nobody has seen
 * fire, which is why this is a pure function over values rather than something
 * that needs a broken deployment to exercise.
 */

const iri = slug => `${NAMESPACES.pu}plugin/${slug}`

describe('a healthy instance', () => {
  it('has nothing to report', () => {
    expect(healthProblems({ unindexed: [], authProblem: null })).toEqual([])
    expect(healthProblems()).toEqual([])
  })

  it('is ok, which is a claim about consistency and not only about serving', () => {
    expect(healthStatus([])).toBe('ok')
  })
})

describe('a plugin the vector index does not hold', () => {
  const problems = healthProblems({ unindexed: [iri('wet-reverb-693085a0'), iri('dry-delay-1a2b3c4d')] })

  it('is reported, rather than left to a log line', () => {
    expect(problems).toHaveLength(1)
    expect(problems[0].what).toBe('unindexed')
  })

  it('says what the consequence is, not just the count', () => {
    // "2 unindexed" means nothing to somebody reading a monitor at 3am. That
    // they are invisible to semantic search is the fact worth waking up for.
    expect(problems[0].detail).toContain('2 plugin(s)')
    expect(problems[0].detail).toMatch(/invisible to semantic search/)
  })

  it('names the remedy, because this failure has one cause', () => {
    // Checked against the scripts that exist: the first draft of this message
    // named `bin/embed.js`, which does not and never did. An error message that
    // sends somebody to a missing script is worse than one that says nothing.
    expect(problems[0].detail).toContain('bin/ingest.js --only-new')
  })

  it('names which plugins, by slug', () => {
    // "three are missing" is a fact; "these three are missing" is something
    // somebody can act on.
    expect(problems[0].plugins).toEqual(['wet-reverb-693085a0', 'dry-delay-1a2b3c4d'])
  })

  it('samples rather than printing the whole catalogue', () => {
    // A monitor that has to parse eight hundred IRIs is a monitor that times
    // out, and the count above already carries the scale.
    const many = Array.from({ length: 800 }, (_, n) => iri(`plugin-${n}`))
    const [problem] = healthProblems({ unindexed: many })
    expect(problem.plugins).toHaveLength(10)
    expect(problem.detail).toContain('800 plugin(s)')
  })

  it('makes the instance degraded, which is what a monitor watches', () => {
    expect(healthStatus(problems)).toBe('degraded')
  })
})

describe('the remedy it names', () => {
  it('is a script that exists, with the flag it is given', () => {
    // The first draft said `bin/embed.js --only-new`. There is no bin/embed.js
    // and there never was — embedding lives in bin/ingest.js. A message that
    // sends somebody to a missing script costs more than one that says nothing,
    // and nothing in a test suite reads prose.
    const [problem] = healthProblems({ unindexed: ['urn:x'] })
    const named = problem.detail.match(/node (bin\/[\w-]+\.js)( --[\w-]+)?/)
    expect(named, 'the message names no command').toBeTruthy()
    expect(existsSync(named[1]), `${named[1]} does not exist`).toBe(true)
    if (named[2]) {
      expect(readFileSync(named[1], 'utf8'), `${named[1]} does not accept ${named[2].trim()}`)
        .toContain(named[2].trim())
    }
  })
})

describe('a half-configured sign-in', () => {
  it('is a problem too, in the same list', () => {
    // It was already reported in a field of its own. A monitor should not have
    // to know the name of every field that might carry bad news.
    const problems = healthProblems({ authProblem: 'sign-in is configured but unusable: no secret' })
    expect(problems).toHaveLength(1)
    expect(problems[0].what).toBe('sign-in')
    expect(healthStatus(problems)).toBe('degraded')
  })

  it('is listed alongside an indexing problem rather than instead of it', () => {
    const problems = healthProblems({ unindexed: [iri('x-1')], authProblem: 'broken' })
    expect(problems.map(one => one.what)).toEqual(['unindexed', 'sign-in'])
  })
})
