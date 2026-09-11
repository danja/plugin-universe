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
let warned = 0
for (const { graph } of graphs) {
  const report = await validator.validateGraph(client, graph)
  // Warnings are reported and do not fail the run. They mean "we did not
  // recognise this", which is a thing to go and look at rather than a defect
  // in the graph — an unrecognised licence identifier is the case that exists.
  const counts = [
    report.violations.length ? `${report.violations.length} violations` : null,
    report.warnings.length ? `${report.warnings.length} warnings` : null
  ].filter(Boolean).join(', ')
  const mark = !report.conforms ? '✗' : report.warnings.length ? '!' : '✓'
  console.log(`${mark} ${graph}  ${counts || 'ok'}`)
  if (report.results.length) {
    if (!report.conforms) failed += 1
    if (report.warnings.length) warned += 1
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
if (warned > 0) {
  console.log(`\nEvery graph conforms. ${warned} graph(s) raised warnings — see above.`)
} else {
  console.log('\nEvery graph conforms.')
}
