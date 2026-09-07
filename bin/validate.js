#!/usr/bin/env node
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import GraphRegistry from '../src/store/GraphRegistry.js'
import ShapeValidator, { summarise } from '../src/store/ShapeValidator.js'

/**
 * Validate the store against vocabs/shapes.ttl, graph by graph.
 *
 * Per graph rather than all at once, so a report names the source that needs
 * fixing. The graph model is the contract between harvesters; this is what
 * checks that they are all keeping it.
 *
 * Usage: node bin/validate.js [--graph <iri>] [--verbose]
 */

const args = process.argv.slice(2)
const only = args.includes('--graph') ? args[args.indexOf('--graph') + 1] : null
const verbose = args.includes('--verbose')

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const validator = await ShapeValidator.load()
const registry = new GraphRegistry(client)

const graphs = only
  ? [{ graph: only }]
  : [...(await registry.list()), { graph: `${config.get('baseUri')}graphs` }]

let failed = 0
for (const { graph } of graphs) {
  const report = await validator.validateGraph(client, graph)
  const status = report.conforms ? 'ok' : `${report.results.length} violations`
  console.log(`${report.conforms ? '✓' : '✗'} ${graph}  ${status}`)
  if (!report.conforms) {
    failed += 1
    console.log(summarise(report))
    if (verbose) {
      for (const result of report.results.slice(0, 20)) {
        console.log(`      ${result.focusNode} ${result.path ?? ''} ${result.value ?? ''}`)
      }
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} graph(s) do not conform.`)
  process.exit(1)
}
console.log('\nEvery graph conforms.')
