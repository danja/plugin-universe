import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { NamespaceManager } from '../rdf/NamespaceManager.js'

/**
 * File-based SPARQL query loading.
 *
 * Queries live in sparql/queries/<category>/<name>.sparql and are named, not
 * pasted. This is the best idea in semem — but semem has two loaders with two
 * interpolation syntaxes plus a third set of templates elsewhere, so here there
 * is exactly one loader and one syntax.
 *
 * Placeholders are ${name}. Every placeholder must be supplied: an unfilled one
 * is an error rather than an empty string, because a silently empty graph name
 * produces a query that runs and returns the wrong thing.
 *
 * Prefixes come from the NamespaceManager rather than a prefixes file, so a
 * query cannot use a prefix the code does not know about.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '../..')

export class QueryError extends Error {
  constructor (message) {
    super(message)
    this.name = 'QueryError'
  }
}

export class QueryService {
  constructor ({ queryPath = path.join(PROJECT_ROOT, 'sparql/queries') } = {}) {
    this.queryPath = queryPath
    this.namespaces = new NamespaceManager()
    this.cache = new Map()
  }

  /** Resolve "graph/register" to its file, with the mtime for cache validity. */
  #resolve (name) {
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
      throw new QueryError(`Query name must be "category/name", got ${JSON.stringify(name)}`)
    }
    const file = path.join(this.queryPath, `${name}.sparql`)
    if (!fs.existsSync(file)) {
      throw new QueryError(`No such query: ${name} (looked in ${file})`)
    }
    return file
  }

  /** Raw template text, cached until the file changes on disk. */
  template (name) {
    const file = this.#resolve(name)
    const mtime = fs.statSync(file).mtimeMs
    const cached = this.cache.get(name)
    if (cached && cached.mtime === mtime) return cached.text
    const text = fs.readFileSync(file, 'utf8')
    this.cache.set(name, { mtime, text })
    return text
  }

  /**
   * Load a query and fill its placeholders.
   *
   * Values are inserted verbatim: they are expected to be already-formatted
   * SPARQL terms from SPARQLHelper (iri(), literal(), typedLiteral()). Passing
   * a bare string here would be an injection, which is why the helpers exist
   * and why nothing in this class tries to quote anything itself.
   */
  get (name, params = {}) {
    const template = this.template(name)
    const required = new Set([...template.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]))
    const supplied = new Set(Object.keys(params))

    const missing = [...required].filter(key => !supplied.has(key))
    if (missing.length) {
      throw new QueryError(`Query ${name} needs parameters not supplied: ${missing.join(', ')}`)
    }
    const unused = [...supplied].filter(key => !required.has(key))
    if (unused.length) {
      throw new QueryError(
        `Query ${name} was given parameters it does not use: ${unused.join(', ')}. ` +
        'This usually means the query or the caller has drifted.'
      )
    }

    const body = template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_m, key) => String(params[key]))
    return `${this.namespaces.sparqlPrefixes()}\n\n${body}`
  }

  /** Every query on disk. Used by a test to assert they all parse. */
  list () {
    const names = []
    for (const category of fs.readdirSync(this.queryPath)) {
      const dir = path.join(this.queryPath, category)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.sparql')) names.push(`${category}/${file.replace(/\.sparql$/, '')}`)
      }
    }
    return names.sort()
  }
}

export default QueryService
