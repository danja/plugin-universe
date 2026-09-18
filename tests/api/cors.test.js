import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { POST_PATHS, acceptsPost, preflightHeaders } from '../../src/api/server.js'
import { JSON_HEADERS } from '../../src/api/respond.js'
import { MCP_PATH } from '../../src/mcp/server.js'

/**
 * Cross-origin access, which is open on purpose and has to be open *correctly*.
 *
 * The catalogue is CC0 and every response says so, so `Access-Control-Allow-
 * Origin: *` is the intended posture — a dataset nobody can call from a browser
 * is not much of an open dataset. What was not intended is the preflight: the
 * answer to an OPTIONS request was one fixed object saying `GET, OPTIONS`, for
 * every path, including the ten that accept a POST and the MCP endpoint that
 * accepts nothing else. A browser reading that never sends the real request.
 *
 * This is the billing-route failure in another costume — a second list (the
 * methods) that had to agree with the first (`POST_PATHS`) and did not, with
 * every server-side test passing because none of them is a browser. The answer
 * is the same as it was there: one list, read twice.
 */

describe('what a preflight is told', () => {
  it('offers POST on every path the guard accepts one on', () => {
    const paths = [
      '/submit', '/feedback', '/admin', '/moderation',
      '/billing/subscribe', '/billing/portal', '/billing/webhook',
      '/plugin/wet-reverb-693085a0/correct',
      '/plugin/wet-reverb-693085a0/image',
      '/plugin/wet-reverb-693085a0/wiki',
      '/plugin/wet-reverb-693085a0/promote',
      '/auth/login', '/auth/callback', MCP_PATH
    ]
    for (const path of paths) {
      expect(acceptsPost(path), `the guard refuses a POST to ${path}`).toBe(true)
      expect(preflightHeaders(path)['Access-Control-Allow-Methods'], path).toContain('POST')
    }
  })

  it('does not offer POST on a path that only reads', () => {
    for (const path of ['/', '/plugins', '/search', '/facets', '/health', '/plugin/x']) {
      expect(acceptsPost(path), `${path} accepts a POST`).toBe(false)
      expect(preflightHeaders(path)['Access-Control-Allow-Methods'], path).not.toContain('POST')
    }
  })

  it('allows the one header a JSON POST cannot travel without', () => {
    // `Content-Type: application/json` is not a CORS-safelisted value, so a
    // preflight that names every method and no header still refuses the
    // request. MCP is JSON-RPC and this is the whole of its client side.
    const headers = preflightHeaders(MCP_PATH)['Access-Control-Allow-Headers']
    expect(headers).toContain('Content-Type')
    expect(headers).toContain('Accept')
  })

  it('keeps the open origin the rest of the API answers with', () => {
    // One posture, not two: whatever a preflight says must match what the
    // actual response carries, or the preflight passes and the request fails.
    expect(preflightHeaders('/plugins')['Access-Control-Allow-Origin'])
      .toBe(JSON_HEADERS['Access-Control-Allow-Origin'])
  })
})

/**
 * The guard's list and the probe that proves the guard lets a request through.
 *
 * `tests/store/server-starts.test.js` POSTs to each write route against a real
 * process, which is the only check that has ever caught this class of failure.
 * It carries its own literal list, so a route added to `POST_PATHS` and not to
 * it is untested in the one place that would notice — and CLAUDE.md says to add
 * both, which is a checklist entry rather than something that fails.
 */
describe('the write routes and the probe that reaches them', () => {
  const probe = fs.readFileSync('tests/store/server-starts.test.js', 'utf8')
  const match = probe.match(/const WRITE_PATHS = \[([\s\S]*?)\]/)

  it('finds the probe list', () => {
    expect(match, 'server-starts.test.js no longer declares WRITE_PATHS').toBeTruthy()
  })

  it('probes every path the guard opens', () => {
    const probed = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    const unprobed = POST_PATHS.filter(pattern => !probed.some(
      path => pattern instanceof RegExp ? pattern.test(path) : pattern === path))
    expect(
      unprobed.map(String),
      'in POST_PATHS and never POSTed to by server-starts.test.js, so nothing would ' +
      'notice it answering 405'
    ).toEqual([])
  })
})

/**
 * The edge and the app must answer a preflight the same way.
 *
 * Both answer one: the app because it is reachable without a proxy in front of
 * it, nginx because `add_header` at the vhost applies to a proxied response
 * too. That is fine as long as only one set reaches the client — the nginx
 * files hide the upstream's — and as long as the two say the same thing, which
 * nothing else checks. An MCP client sending `Mcp-Protocol-Version` against a
 * deployment that allows it and a development server that does not is a bug
 * that only ever appears in one of the two places.
 */
describe('the proxy and the app agree', () => {
  const mcpConf = fs.readFileSync('deploy/nginx/mcp.plugin-universe.conf', 'utf8')

  /** The value of one add_header directive in an nginx file. */
  const added = (conf, header) =>
    conf.match(new RegExp(`add_header ${header} "([^"]*)"`))?.[1] ?? null

  it('allows the same request headers at both ends', () => {
    const app = preflightHeaders(MCP_PATH)['Access-Control-Allow-Headers']
      .split(',').map(name => name.trim().toLowerCase())
    const proxy = added(mcpConf, 'Access-Control-Allow-Headers')
    expect(proxy, 'the mcp vhost sets no Access-Control-Allow-Headers').toBeTruthy()
    const allowed = proxy.split(',').map(name => name.trim().toLowerCase())
    for (const name of app) {
      expect(allowed, `the mcp vhost refuses ${name}, which the app allows`).toContain(name)
    }
  })

  it('hides the upstream CORS headers wherever it sets its own', () => {
    // Two Access-Control-Allow-Origin headers is invalid rather than doubly
    // permissive, and the browser is the only thing that says so: curl reports
    // both quite happily. The same applies to the SPARQL vhost, where the
    // upstream answering is Fuseki rather than this app.
    for (const file of [
      'deploy/nginx/mcp.plugin-universe.conf',
      'deploy/nginx/sparql.plugin-universe.conf'
    ]) {
      const conf = fs.readFileSync(file, 'utf8')
      if (!/add_header Access-Control-Allow-Origin/.test(conf)) continue
      const proxied = (conf.match(/proxy_pass/g) ?? []).length
      const hidden = (conf.match(/proxy_hide_header Access-Control-Allow-Origin;/g) ?? []).length
      expect(hidden, `${file} proxies ${proxied} location(s) and hides the upstream ` +
        `Access-Control-Allow-Origin in ${hidden} of them`).toBe(proxied)
    }
  })
})
