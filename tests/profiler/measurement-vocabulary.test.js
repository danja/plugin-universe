import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { parseTurtleFile } from '../../src/harvest/TurtleReader.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The serialiser and the ontology, bound together.
 *
 * This is the project's recurring failure written as a test. Five times a
 * change has been made in one file while a second file that had to change with
 * it was left alone, and a metric is exactly that shape: `measurement('CpuLoad',
 * …)` mints `pu:CpuLoad` and writes it, and nothing anywhere complains if the
 * ontology has never heard of it. The triple is valid RDF, the SHACL shapes
 * pass — they require *a* metric IRI, not a described one — and the result is a
 * measurement whose metric has no label, no unit and no definition, discovered
 * whenever someone next looks at a plugin page.
 *
 * CLAUDE.md: new RDF terms go in vocabs/ first, code follows the ontology.
 * This is what makes that true rather than remembered.
 */

const pu = NAMESPACES.pu
const rdfType = `${NAMESPACES.rdf}type`

/** Metric names the serialiser passes to its `measurement(...)` helper. */
function metricsWritten (source) {
  return [...source.matchAll(/\bmeasurement\s*\(\s*'([A-Za-z]+)'/g)].map(match => match[1])
}

/** pu: properties the serialiser writes, however they are assembled. */
function propertiesWritten (source) {
  return [...source.matchAll(/iri\s*\(\s*pu\s*\+\s*'([a-z][A-Za-z]*)'\s*\)/g)].map(match => match[1])
}

describe('profiler measurements are described by the ontology', () => {
  it('finds the metrics and properties the serialiser writes', async () => {
    const source = await readFile('src/profiler/MeasurementSerialiser.js', 'utf8')
    // A guard that finds nothing passes forever. Both scrapes must bite.
    expect(metricsWritten(source).length).toBeGreaterThan(4)
    expect(propertiesWritten(source).length).toBeGreaterThan(4)
  })

  it('declares every metric the serialiser writes as a pu:Metric', async () => {
    const source = await readFile('src/profiler/MeasurementSerialiser.js', 'utf8')
    const vocabulary = await parseTurtleFile('vocabs/plugin-universe.ttl')

    const described = new Set()
    for (const quad of vocabulary) {
      if (quad.predicate.value === rdfType && quad.object.value === `${pu}Metric`) {
        described.add(quad.subject.value)
      }
    }

    const undescribed = [...new Set(metricsWritten(source))]
      .filter(metric => !described.has(pu + metric))
    expect(undescribed, 'metrics written by the profiler but absent from vocabs/plugin-universe.ttl').toEqual([])
  })

  it('declares every measurement property the serialiser writes', async () => {
    const source = await readFile('src/profiler/MeasurementSerialiser.js', 'utf8')
    const vocabulary = await parseTurtleFile('vocabs/plugin-universe.ttl')

    const declared = new Set()
    for (const quad of vocabulary) {
      if (quad.predicate.value === rdfType && quad.object.value.startsWith(NAMESPACES.owl)) {
        declared.add(quad.subject.value)
      }
    }

    const undeclared = [...new Set(propertiesWritten(source))]
      .filter(property => !declared.has(pu + property))
    expect(undeclared, 'pu: properties written by the profiler but not declared in vocabs/plugin-universe.ttl').toEqual([])
  })
})
