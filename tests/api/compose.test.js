import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'

/**
 * docker-compose.yml parses, and says what the app needs it to say.
 *
 * There is a `deploy/nginx/check.sh` because six nginx configurations reached
 * the server broken. The compose file had no equivalent, and then a duplicate
 * `volumes:` key reached the server too — the app service already had one
 * further down, and YAML does not merge them, it rejects the document. The
 * deploy failed on a parse error, which is a round trip through a person for
 * something findable here.
 *
 * These are cheap string and structure checks. `docker compose config` is the
 * real validator and is used when it is available, but the suite must not
 * depend on Docker being installed.
 */

const COMPOSE = readFileSync('docker-compose.yml', 'utf8')

/** Top-level keys of one service block, in source order. */
function serviceKeys (name) {
  const start = COMPOSE.indexOf(`\n  ${name}:`)
  expect(start, `no ${name} service`).toBeGreaterThan(-1)
  const rest = COMPOSE.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\S|\n\S/)
  const block = next === -1 ? rest : rest.slice(0, next + 1)
  return [...block.matchAll(/^ {4}([a-z_]+):/gm)].map(match => match[1])
}

describe('the compose file', () => {
  it('defines each key once per service', () => {
    // YAML rejects a duplicate mapping key rather than merging it, so a second
    // `volumes:` is not an addition — it is a file that will not load.
    for (const service of ['fuseki', 'ollama', 'app', 'nginx']) {
      const keys = serviceKeys(service)
      const seen = new Set()
      const duplicated = keys.filter(key => seen.size === seen.add(key).size)
      expect(duplicated, `${service} defines ${duplicated.join(', ')} twice`).toEqual([])
    }
  })

  it('gives the app the host directories nginx serves', () => {
    // Both live under /app/data, which is a named volume — so without an
    // explicit bind mount they are written inside the container where nginx
    // never looks, and the write appears to succeed.
    expect(COMPOSE).toContain('./data/images:/app/data/images')
    expect(COMPOSE).toContain('./data/dumps:/app/data/dumps')
  })

  it('gives nginx the same two directories, read-only', () => {
    expect(COMPOSE).toContain('./data/images:/srv/images:ro')
    expect(COMPOSE).toContain('./data/dumps:/srv/dumps:ro')
  })

  it('mounts them where the nginx config looks for them', () => {
    // The other half of the pairing: the paths in the config and the paths in
    // the compose file have nothing connecting them.
    const config = readFileSync('deploy/nginx/plugin-universe.conf', 'utf8')
    expect(config).toContain('/srv/images/')
    expect(config).toContain('/srv/dumps/')
  })

  it('parses, when Docker is here to say so', () => {
    let output
    try {
      output = execFileSync('docker', ['compose', 'config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      // No Docker, or a daemon that will not answer. The string checks above
      // still ran; this one is a bonus rather than the point.
      if (error.stderr && /yaml|mapping key|did not find/i.test(String(error.stderr))) {
        throw new Error(`docker compose config rejected the file: ${error.stderr}`)
      }
      return
    }
    expect(output).toContain('plugin-universe-app')
  })
})
