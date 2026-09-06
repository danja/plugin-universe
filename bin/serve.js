#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import SearchService from '../src/search/SearchService.js'
import { createServer } from '../src/api/server.js'

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

const server = createServer({ search, config })
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
  console.log('  GET /health           service status')
  console.log('  GET /search?q=...     hybrid search, with optional format/role/category/vendor')
  console.log('  GET /facets           facet values and counts')
  console.log('  GET /plugins          browse')
  console.log('  GET /plugin/<slug>    one plugin')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
