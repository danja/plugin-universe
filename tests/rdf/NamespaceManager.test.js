import { describe, it, expect } from 'vitest'
import { NamespaceManager, NAMESPACES } from '../../src/rdf/NamespaceManager.js'

describe('NamespaceManager', () => {
  const ns = new NamespaceManager()

  it('is the single source of prefix IRIs', () => {
    expect(NAMESPACES.trn).toBe('http://purl.org/stuff/transmissions/')
    expect(NAMESPACES.pu).toBe('http://purl.org/stuff/plugin-universe/')
    expect(NAMESPACES.lv2).toBe('http://lv2plug.in/ns/lv2core#')
  })

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(NAMESPACES)).toBe(true)
  })

  it('has no duplicate IRIs, which would make two prefixes mean one thing', () => {
    const iris = Object.values(NAMESPACES)
    expect(new Set(iris).size).toBe(iris.length)
  })

  it('builds term IRIs', () => {
    expect(ns.trn('PluginProfile').value).toBe('http://purl.org/stuff/transmissions/PluginProfile')
    expect(ns.lv2('port').value).toBe('http://lv2plug.in/ns/lv2core#port')
  })

  it('round-trips shrink and expand', () => {
    const full = 'http://purl.org/stuff/transmissions/PluginProfile'
    expect(ns.shrink(full)).toBe('trn:PluginProfile')
    expect(ns.expand('trn:PluginProfile')).toBe(full)
  })

  it('refuses to expand an unregistered prefix rather than guessing', () => {
    expect(() => ns.expand('nope:Thing')).toThrow()
  })

  it('emits prefix blocks for both SPARQL and Turtle', () => {
    expect(ns.sparqlPrefixes()).toContain('PREFIX pu: <http://purl.org/stuff/plugin-universe/>')
    expect(ns.turtlePrefixes()).toContain('@prefix pu: <http://purl.org/stuff/plugin-universe/> .')
  })
})
