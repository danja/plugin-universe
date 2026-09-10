import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import logger from 'loglevel'
import { registerTools } from './tools.js'

/**
 * The MCP face, over Streamable HTTP.
 *
 * **Stateless.** A fresh server and transport per request, no session id, no
 * state carried between calls. Every tool here answers a question about a
 * public catalogue; there is nothing to remember, and a public endpoint that
 * remembers things is a public endpoint that can be made to remember too many.
 * It also means no cleanup, no session table, and no behaviour that depends on
 * which instance a request reached.
 *
 * **The SDK rather than hand-rolled JSON-RPC**, unlike the Markdown sanitiser
 * in `src/wiki/`, and the distinction is worth keeping straight. That contract
 * is internal — this project decides what HTML it emits and can check it
 * directly. This one is external: the clients are other people's, the spec is
 * somebody else's, and a subtle deviation shows up as "it does not work in my
 * agent" somewhere we cannot see.
 */

export const MCP_PATH = '/mcp'

const SERVER_INFO = {
  name: 'plugin-universe',
  version: '0.1.0',
  title: 'Plugin Universe'
}

const INSTRUCTIONS = `An open, machine-readable catalogue of DAW plugins.

Start with search_plugins and describe what the plugin should *do* — retrieval
is semantic, so "warm analogue bus compressor" works better than a product
name. list_categories shows how the catalogue divides things up and what each
category means. get_plugin returns the full record for one, including where
each fact came from and any measurements taken of the built binary.

sparql_query is there for questions a search cannot answer. It runs against the
published copy of the catalogue, which holds no personal data.

Facts are CC0. Attribution to https://plugin-universe.com is requested and not
required. Where a plugin page is cited, the plugin's own licence is its
author's and is a separate matter from the catalogue's.`

/** A server instance with the catalogue's tools registered on it. */
export function createMcpServer ({ search, publication = null }) {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS
  })
  registerTools(server, { search, publication })
  return server
}

/**
 * Handle one MCP request.
 *
 * Returns true when it answered. The transport writes the response itself, so
 * this deliberately does not go through the project's own `send` helpers.
 */
export async function handleMcp (request, response, { search, publication = null }) {
  if (request.method !== 'POST') {
    // GET is the SSE channel and DELETE ends a session; a stateless server has
    // neither. Saying so plainly is better than an empty stream that never
    // produces anything.
    response.writeHead(405, {
      'Content-Type': 'application/json',
      Allow: 'POST'
    })
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This MCP server is stateless: use POST. There is no SSE channel and no session to end.' },
      id: null
    }))
    return true
  }

  const server = createMcpServer({ search, publication })
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session id is issued, so no session is tracked.
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })

  // The transport owns the socket from here. Closing both when the response
  // finishes is what stops a per-request server leaking for the life of the
  // process.
  response.on('close', () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(request, response)
  } catch (error) {
    logger.error('[mcp]', error)
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null
      }))
    }
  }
  return true
}

export default handleMcp
