import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import VectorIndex, { VectorIndexError } from '../../src/vectors/VectorIndex.js'
import VectorOperations, { VectorError } from '../../src/vectors/VectorOperations.js'

const DIM = 8
const MODEL = 'test-model:v1'

function vec (seed) {
  return Array.from({ length: DIM }, (_, i) => Math.sin(seed * (i + 1)))
}

let dir
let indexPath

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-index-'))
  indexPath = path.join(dir, 'test.index')
})

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('VectorOperations', () => {
  it('normalises to unit length', () => {
    const n = VectorOperations.normalize([3, 4])
    expect(VectorOperations.magnitude(n)).toBeCloseTo(1)
  })

  it('refuses a zero vector rather than returning NaNs', () => {
    expect(() => VectorOperations.normalize([0, 0])).toThrow(VectorError)
  })

  it('refuses a vector of the wrong dimension', () => {
    expect(() => VectorOperations.validate([1, 2], 3)).toThrow(VectorError)
  })

  it('refuses non-finite values', () => {
    expect(() => VectorOperations.validate([1, NaN])).toThrow(VectorError)
  })
})

describe('VectorIndex', () => {
  it('finds the nearest vector by IRI', async () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    index.add('urn:b', vec(2))
    index.add('urn:c', vec(3))

    const hits = index.search(vec(2), 1)
    expect(hits).toHaveLength(1)
    expect(hits[0].iri).toBe('urn:b')
    expect(hits[0].score).toBeCloseTo(1, 4)
  })

  it('applies a minimum score rather than returning weak noise', () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    expect(index.search(vec(1), 5, { minScore: 0.99 })).toHaveLength(1)
    expect(index.search(vec(1).map(v => -v), 5, { minScore: 0.99 })).toHaveLength(0)
  })

  it('returns nothing from an empty index instead of throwing', () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    expect(index.search(vec(1), 5)).toEqual([])
  })

  it('replaces a vector without returning the stale one', () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    index.add('urn:a', vec(9))

    const hits = index.search(vec(9), 5)
    expect(hits.filter(h => h.iri === 'urn:a')).toHaveLength(1)
    expect(index.size).toBe(1)
  })

  it('compacts away orphaned positions', () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    index.add('urn:a', vec(2))
    index.add('urn:b', vec(3))
    expect(index.compact()).toBe(1)
    expect(index.search(vec(2), 5).some(h => h.iri === 'urn:a')).toBe(true)
    expect(index.search(vec(3), 5).some(h => h.iri === 'urn:b')).toBe(true)
  })

  it('persists to disk and reloads with its IRI mapping intact', async () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    index.add('urn:b', vec(2))
    await index.save()

    const reloaded = await VectorIndex.load({ dimension: DIM, path: indexPath, model: MODEL })
    expect(reloaded).not.toBeNull()
    expect(reloaded.size).toBe(2)
    expect(reloaded.search(vec(2), 1)[0].iri).toBe('urn:b')
  })

  it('open() starts empty when nothing has been saved', async () => {
    const index = await VectorIndex.open({ dimension: DIM, path: indexPath, model: MODEL })
    expect(index.size).toBe(0)
  })

  it('refuses to load an index built by a different model', async () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    await index.save()

    await expect(
      VectorIndex.load({ dimension: DIM, path: indexPath, model: 'other-model:v2' })
    ).rejects.toThrow(VectorIndexError)
  })

  it('refuses to load an index of a different dimension', async () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    index.add('urn:a', vec(1))
    await index.save()

    await expect(
      VectorIndex.load({ dimension: DIM + 1, path: indexPath, model: MODEL })
    ).rejects.toThrow(VectorIndexError)
  })

  it('refuses a vector of the wrong dimension on add', () => {
    const index = new VectorIndex({ dimension: DIM, path: indexPath, model: MODEL })
    expect(() => index.add('urn:a', [1, 2, 3])).toThrow()
  })
})
