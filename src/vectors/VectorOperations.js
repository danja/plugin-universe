/**
 * Vector mathematics. No dependencies, no I/O.
 *
 * Ported from semem's src/core/Vectors.js, trimmed to what this project uses.
 */

export class VectorError extends Error {
  constructor (message, { type = 'VECTOR_ERROR' } = {}) {
    super(message)
    this.name = 'VectorError'
    this.type = type
  }
}

export class VectorOperations {
  static validate (vector, expectedDimension = null) {
    if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
      throw new VectorError(`Vector must be an array, got ${typeof vector}`, { type: 'VALIDATION_ERROR' })
    }
    if (vector.length === 0) {
      throw new VectorError('Vector must not be empty', { type: 'VALIDATION_ERROR' })
    }
    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
        throw new VectorError(`Vector contains a non-finite value at index ${i}`, { type: 'VALIDATION_ERROR' })
      }
    }
    if (expectedDimension !== null && vector.length !== expectedDimension) {
      throw new VectorError(
        `Vector dimension ${vector.length} does not match the configured ${expectedDimension}`,
        { type: 'DIMENSION_ERROR' }
      )
    }
    return true
  }

  static magnitude (vector) {
    let sum = 0
    for (const v of vector) sum += v * v
    return Math.sqrt(sum)
  }

  /**
   * Unit-length copy. Normalising up front lets an inner-product index behave
   * as a cosine index, which is why the index stores normalised vectors.
   */
  static normalize (vector) {
    VectorOperations.validate(vector)
    const mag = VectorOperations.magnitude(vector)
    if (mag === 0) {
      throw new VectorError('Cannot normalize a zero vector', { type: 'MATH_ERROR' })
    }
    return Array.from(vector, v => v / mag)
  }

  static cosineSimilarity (a, b) {
    VectorOperations.validate(a)
    VectorOperations.validate(b)
    if (a.length !== b.length) {
      throw new VectorError(`Dimension mismatch: ${a.length} vs ${b.length}`, { type: 'DIMENSION_ERROR' })
    }
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }
}

export default VectorOperations
