import { describe, it, expect, beforeAll } from 'vitest'
import LexicalIndex, { tokenise } from '../../src/search/LexicalIndex.js'

const corpus = [
  { name: 'Drift', vendor: 'danja', description: 'MIDI CC modulator synced to host time', roles: ['MidiGenerator'], categories: ['midi'], parameters: ['Rate'] },
  { name: 'Tape Machine', vendor: 'testaudio', description: 'Tape saturation with time-based wow and flutter', roles: [], categories: ['distortion'], parameters: ['Drive'] },
  { name: 'Echo Chamber', vendor: 'testaudio', description: 'Stereo delay with time and feedback', roles: [], categories: ['delay'], parameters: ['Time'] },
  { name: 'Cathedral', vendor: 'testaudio', description: 'Algorithmic reverb with long decay time', roles: [], categories: ['reverb'], parameters: ['Decay'] }
]

let index

beforeAll(() => {
  index = new LexicalIndex()
  index.build(corpus)
})

describe('tokenise', () => {
  it('folds case and splits on punctuation', () => {
    expect(tokenise('Pro-Q 4')).toEqual(['pro'])
    expect(tokenise('Tape Machine')).toEqual(['tape', 'machine'])
  })

  it('drops single characters, which carry no signal', () => {
    expect(tokenise('a b cd')).toEqual(['cd'])
  })

  it('survives null and undefined', () => {
    expect(tokenise(null)).toEqual([])
    expect(tokenise(undefined)).toEqual([])
  })
})

describe('inverse document frequency', () => {
  it('scores a term the whole corpus shares far below a rare one', () => {
    // "time" is in all four descriptions; "reverb" is in one.
    expect(index.idf('time')).toBeLessThan(index.idf('reverb'))
  })

  it('gives an unseen term full weight, since it cannot be common', () => {
    expect(index.idf('vocoder')).toBe(1)
  })

  it('returns a uniform weight before the corpus is built', () => {
    expect(new LexicalIndex().idf('anything')).toBe(1)
  })
})

describe('scoring', () => {
  it('gives an exact name match the top score', () => {
    expect(index.score(tokenise('drift'), corpus[0])).toBe(1)
    expect(index.score(tokenise('tape machine'), corpus[1])).toBe(1)
  })

  it('never lets a non-exact match reach the top score', () => {
    for (const doc of corpus) {
      const score = index.score(tokenise('midi cc modulator'), doc)
      if (String(doc.name).toLowerCase() !== 'midi cc modulator') {
        expect(score).toBeLessThan(1)
      }
    }
  })

  it('ranks a name match above a description match', () => {
    const named = index.score(tokenise('echo'), corpus[2])
    const described = index.score(tokenise('echo'), corpus[0])
    expect(named).toBeGreaterThan(described)
  })

  it('does not reward a query made only of corpus-wide words', () => {
    // Every description mentions time. A query of only that should not
    // strongly prefer any one plugin.
    const scores = corpus.map(doc => index.score(tokenise('time'), doc))
    const spread = Math.max(...scores) - Math.min(...scores)
    expect(spread).toBeLessThan(0.6)
  })

  it('lets a rare term dominate a common one in the same query', () => {
    // "reverb" is rare, "time" is universal: Cathedral should win.
    const query = tokenise('reverb time')
    const cathedral = index.score(query, corpus[3])
    const others = corpus.filter((_, i) => i !== 3).map(doc => index.score(query, doc))
    expect(cathedral).toBeGreaterThan(Math.max(...others))
  })

  it('scores an unrelated query at zero', () => {
    expect(index.score(tokenise('xylophone'), corpus[0])).toBe(0)
  })

  it('scores an empty query at zero', () => {
    expect(index.score([], corpus[0])).toBe(0)
  })
})
