import { createHash } from 'crypto'
import logger from 'loglevel'
import { EMBEDDING_CONFIG } from '../../config/preferences.js'
import VectorOperations from '../vectors/VectorOperations.js'

/**
 * Embedding generation.
 *
 * The text embedded for a plugin is composed from the graph — name, vendor,
 * description, role labels, tag labels, parameter names — rather than taken
 * from a description field. Plugin descriptions are frequently one line of
 * marketing; the composed view is what makes semantic search work on them.
 *
 * See docs/architecture.md §4.
 */

export class EmbeddingError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'EmbeddingError'
    if (cause) this.cause = cause
  }
}

/**
 * The local name of an IRI, or a plain word unchanged.
 *
 * Two shapes of plugin record reach composeText: the normalised harvest record,
 * whose roles and formats are full IRIs, and the SPARQL text view, whose
 * equivalents are already shortened by the query. Embedding a URL is worse than
 * useless — every plugin shares the same prefix, so it is uniform noise that
 * dilutes the words that discriminate.
 */
function localName (term) {
  if (typeof term !== 'string') {
    throw new EmbeddingError(`Expected an IRI or a label, got ${typeof term}`)
  }
  const cut = Math.max(term.lastIndexOf('/'), term.lastIndexOf('#'))
  return cut === -1 ? term : term.slice(cut + 1)
}

/**
 * A parameter's human-readable name, from either shape.
 *
 * The text view supplies strings; a harvest record supplies port objects. A
 * third shape is an error rather than something to stringify: `String(port)`
 * yields "[object Object]", which is exactly the defect this replaces.
 */
function parameterName (parameter) {
  if (typeof parameter === 'string') return parameter
  if (parameter && typeof parameter === 'object') {
    const name = parameter.name ?? parameter.symbol
    if (name) return String(name)
  }
  throw new EmbeddingError(
    `A parameter must be a name or an object with a name or symbol, got ${JSON.stringify(parameter)}`
  )
}

/**
 * Reduce either record shape to the fields the text is composed from, so that
 * the same plugin produces the same text whether it arrives from the harvester
 * or from the store. It did not, before: the index was built from harvest
 * records and so embedded raw IRIs and "[object Object]" for every parameter,
 * while the lexical signal matched against the clean text view.
 */
export function textView (plugin) {
  if (!plugin || !plugin.name) {
    throw new EmbeddingError('Cannot compose text for a plugin with no name')
  }
  return {
    name: plugin.name,
    vendor: plugin.vendor ?? null,
    roles: (plugin.roles ?? []).map(localName),
    formats: (plugin.formats ?? []).map(localName),
    categories: (plugin.categories ?? []).map(localName),
    description: plugin.description ?? null,
    tags: plugin.tags ?? [],
    parameters: (plugin.parameters ?? []).map(parameterName)
  }
}

/**
 * Build the text that represents a plugin for retrieval.
 *
 * Field order is fixed and the output is deterministic: the hash of this string
 * is what tells us whether a stored embedding is stale, so it must not vary
 * between runs for unchanged data.
 */
export function composeText (plugin) {
  const view = textView(plugin)
  const parts = [view.name]
  if (view.vendor) parts.push(`by ${view.vendor}`)
  if (view.roles.length) parts.push(view.roles.join(', '))
  if (view.categories.length) parts.push(view.categories.join(', '))
  if (view.formats.length) parts.push(view.formats.join(', '))
  if (view.description) parts.push(view.description)
  if (view.tags.length) parts.push(view.tags.join(', '))
  if (view.parameters.length) parts.push(`Parameters: ${view.parameters.join(', ')}`)
  return parts.join('. ')
}

export function textHash (text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Ollama embedding provider. Kept behind the EmbeddingService interface so a
 * second provider can be added without touching callers.
 */
export class OllamaEmbeddingProvider {
  constructor ({ baseUrl, model, dimension }) {
    for (const [key, value] of Object.entries({ baseUrl, model, dimension })) {
      if (!value) throw new EmbeddingError(`OllamaEmbeddingProvider needs ${key}`)
    }
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.dimension = dimension
  }

  async embed (text) {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(EMBEDDING_CONFIG.requestTimeoutMs)
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new EmbeddingError(`Ollama returned HTTP ${response.status}: ${detail}`)
    }
    const body = await response.json()
    if (!Array.isArray(body.embedding)) {
      throw new EmbeddingError('Ollama response contained no embedding array')
    }
    return body.embedding
  }

  async isAvailable () {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) return false
      const { models } = await response.json()
      return models.some(m => m.name === this.model)
    } catch {
      return false
    }
  }
}

export class EmbeddingService {
  /**
   * @param {object} options - from config.get('embedding')
   */
  constructor ({ provider, baseUrl, model, dimension }) {
    if (provider !== 'ollama') {
      throw new EmbeddingError(
        `Unsupported embedding provider "${provider}". Only "ollama" is implemented; ` +
        'add a provider class rather than special-casing at the call site.'
      )
    }
    this.model = model
    this.dimension = dimension
    this.provider = new OllamaEmbeddingProvider({ baseUrl, model, dimension })
  }

  static fromConfig (config) {
    return new EmbeddingService(config.get('embedding'))
  }

  /**
   * Embed one string, with retries. A dimension mismatch is an error rather
   * than something to pad or truncate: it means the configured model is not the
   * model that answered, and quietly reshaping the vector would hide that.
   */
  async embed (text) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new EmbeddingError('Cannot embed empty text')
    }
    let lastError = null
    for (let attempt = 1; attempt <= EMBEDDING_CONFIG.maxRetries; attempt++) {
      try {
        const vector = await this.provider.embed(text)
        VectorOperations.validate(vector, this.dimension)
        return vector
      } catch (error) {
        lastError = error
        if (error.type === 'DIMENSION_ERROR') throw error
        logger.warn(`[embedding] attempt ${attempt} failed: ${error.message}`)
        if (attempt < EMBEDDING_CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, EMBEDDING_CONFIG.retryBackoffMs * attempt))
        }
      }
    }
    throw new EmbeddingError(
      `Embedding failed after ${EMBEDDING_CONFIG.maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError }
    )
  }

  /**
   * Embed a plugin, returning what the index needs and what the graph needs to
   * record about it.
   */
  async embedPlugin (plugin) {
    const text = composeText(plugin)
    const vector = await this.embed(text)
    return {
      vector,
      text,
      hash: textHash(text),
      model: this.model,
      dimension: this.dimension,
      embeddedAt: new Date().toISOString()
    }
  }

  /** Sequential by default: an embedding server is usually the bottleneck. */
  async embedBatch (plugins) {
    const results = []
    for (const plugin of plugins) {
      results.push(await this.embedPlugin(plugin))
    }
    return results
  }

  async isAvailable () {
    return this.provider.isAvailable()
  }
}

export default EmbeddingService
