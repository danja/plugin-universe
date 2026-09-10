#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import SearchService from '../src/search/SearchService.js'
import { createServer } from '../src/api/server.js'
import Accounts from '../src/auth/Accounts.js'
import AuthRoutes from '../src/auth/routes.js'
import Corrections from '../src/contrib/Corrections.js'
import Wiki from '../src/wiki/Wiki.js'

logger.setLevel('info')

const config = Config.load()
const port = Number(process.env.PORT) || 4100

const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})
const embeddings = EmbeddingService.fromConfig(config)
const search = new SearchService({ client, index, embeddings })
const loaded = await search.loadDocuments()

// Loaded once at start, not per request: the index is the hot path and it is
// read from disk, not rebuilt from the triple store.
console.log(`Loaded ${loaded} plugins, ${index.size} vectors from ${index.path}`)

// Sign-in, when the instance is configured for it. A read-only deployment is a
// legitimate thing to run and does not need an OAuth App.
// `||`, not `??`. docker-compose passes `${SITE_ORIGIN:-}`, which is an empty
// string when the variable is unset — and `?? ` only falls back on null or
// undefined, so an unset variable arrived as '' and defeated the default. This
// took the site down with "needs the site origin". An empty environment
// variable means unset everywhere in this project; Config.js already treats it
// that way.
const origin = process.env.SITE_ORIGIN || config.get('site.origin')
const accounts = new Accounts(client)
const { routes: auth, reason: authProblem } = AuthRoutes.fromEnvironment({ accounts, origin })
let corrections = null
let wiki = null
if (auth) {
  // Registered at startup, not at first sign-in: a graph holding personal data
  // that is not flagged as such is the one failure this design exists to
  // prevent, and it must not wait on somebody signing in.
  await accounts.ensureGraph()
  corrections = new Corrections(client)
  await corrections.ensureGraph()
  console.log(`Sign-in enabled, callback ${origin}/auth/callback`)
  wiki = new Wiki(client)
  console.log('Contributions enabled')
  console.log('Wiki enabled')
} else if (authProblem) {
  console.log(`Sign-in DISABLED — ${authProblem}`)
} else {
  console.log('Sign-in disabled (no GITHUB_CLIENT_ID/SECRET); the site is read-only')
}

const server = createServer({
  search, config, projectRoot: Config.projectRoot, auth, corrections, wiki, authProblem
})
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
  console.log('  GET /health           service status')
  console.log('  GET /search?q=...     hybrid search, with optional format/role/category/vendor')
  console.log('  GET /facets           facet values and counts')
  console.log('  GET /plugins          browse')
  console.log('  GET /plugin/<slug>    one plugin')
  console.log('  GET /category/<slug>  one category, and what is in it')
  console.log('  GET /ns/<name>.ttl    the vocabularies the data refers to')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
