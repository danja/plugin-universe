import logger from 'loglevel'

/**
 * Low-level SPARQL endpoint access.
 *
 * Ported from semem's src/stores/modules/SPARQLExecute.js. One deliberate
 * change: semem defaulted missing credentials to admin/admin. Here a missing
 * credential is an error, per the no-inline-fallbacks rule — silently trying
 * a guessed password against a configured endpoint is worse than stopping.
 */
export class SPARQLError extends Error {
  constructor (message, { status = null, query = null } = {}) {
    super(message)
    this.name = 'SPARQLError'
    this.status = status
    this.query = query
  }
}

export class SPARQLClient {
  /**
   * @param {{query: string, update: string, user?: string, password?: string}} endpoint
   */
  constructor (endpoint) {
    if (!endpoint || typeof endpoint !== 'object') {
      throw new SPARQLError('SPARQLClient needs an endpoint object')
    }
    for (const key of ['query', 'update']) {
      if (!endpoint[key]) throw new SPARQLError(`SPARQLClient endpoint is missing "${key}"`)
    }
    this.queryUrl = endpoint.query
    this.updateUrl = endpoint.update

    // Auth is optional as a whole — a local unsecured Fuseki is a legitimate
    // configuration — but a half-specified credential is a mistake.
    const hasUser = endpoint.user !== undefined && endpoint.user !== ''
    const hasPassword = endpoint.password !== undefined && endpoint.password !== ''
    if (hasUser !== hasPassword) {
      throw new SPARQLError('SPARQL endpoint has a user without a password, or the reverse')
    }
    this.authHeader = hasUser
      ? 'Basic ' + Buffer.from(`${endpoint.user}:${endpoint.password}`).toString('base64')
      : null
  }

  #headers (contentType, accept) {
    const headers = { 'Content-Type': contentType, Accept: accept }
    if (this.authHeader) headers.Authorization = this.authHeader
    return headers
  }

  /**
   * @returns {Promise<object>} SPARQL JSON results
   */
  async query (sparql) {
    const response = await fetch(this.queryUrl, {
      method: 'POST',
      headers: this.#headers('application/sparql-query', 'application/sparql-results+json'),
      body: sparql
    })
    if (!response.ok) {
      const detail = await response.text()
      logger.error('[SPARQL query failed]', { url: this.queryUrl, status: response.status, detail })
      throw new SPARQLError(`Query failed: HTTP ${response.status} ${detail}`.trim(), {
        status: response.status,
        query: sparql
      })
    }
    return response.json()
  }

  async update (sparql) {
    const response = await fetch(this.updateUrl, {
      method: 'POST',
      headers: this.#headers('application/sparql-update', 'text/plain'),
      body: sparql
    })
    if (!response.ok) {
      const detail = await response.text()
      logger.error('[SPARQL update failed]', { url: this.updateUrl, status: response.status, detail })
      throw new SPARQLError(`Update failed: HTTP ${response.status} ${detail}`.trim(), {
        status: response.status,
        query: sparql
      })
    }
    return true
  }

  /** SELECT, flattened to plain objects keyed by variable name. */
  async select (sparql) {
    const results = await this.query(sparql)
    return results.results.bindings.map(binding => {
      const row = {}
      for (const [key, node] of Object.entries(binding)) row[key] = node.value
      return row
    })
  }

  async ask (sparql) {
    const results = await this.query(sparql)
    return results.boolean === true
  }

  /**
   * CONSTRUCT, returned as Turtle.
   *
   * Separate from query() because a CONSTRUCT does not answer with SPARQL JSON:
   * it answers with a graph, and the caller wants the triples. Used by shape
   * validation and by dump assembly, both of which need the graph rather than
   * rows to reassemble in JavaScript.
   */
  async construct (sparql) {
    const response = await fetch(this.queryUrl, {
      method: 'POST',
      headers: this.#headers('application/sparql-query', 'text/turtle'),
      body: sparql
    })
    if (!response.ok) {
      const detail = await response.text()
      logger.error('[SPARQL construct failed]', { url: this.queryUrl, status: response.status, detail })
      throw new SPARQLError(`Construct failed: HTTP ${response.status} ${detail}`.trim(), {
        status: response.status,
        query: sparql
      })
    }
    return response.text()
  }

  /** True if the endpoint answers at all. Used by tests to fail loudly. */
  async isReachable () {
    try {
      await this.ask('ASK { ?s ?p ?o }')
      return true
    } catch {
      return false
    }
  }
}

export default SPARQLClient
