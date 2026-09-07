import Sandbox, { OUTCOME } from './Sandbox.js'
import { PROFILER_CONFIG } from '../../config/preferences.js'

/**
 * Scanning built LV2 binaries through lilv, in the sandbox.
 *
 * This is discovery, not harvesting, and the difference is the whole reason it
 * exists. The harvester reads a bundle's Turtle from a source tree and skips
 * build directories; the scanner reads what lilv reports from the *built*
 * bundle, which is what a host actually loads. Where the two disagree, the scan
 * wins — that is the source-precedence rule in docs/architecture.md §8, and it
 * cannot be applied without both halves.
 *
 * lilv is used rather than a bespoke parser for the same reason: it is the
 * library hosts use, so what it can see is what a host can see. A bundle whose
 * Turtle is beautiful and whose binary is missing scans as nothing, and that is
 * the truth about it.
 *
 * Everything runs inside Sandbox. lilv dlopens the plugin binary to read some
 * properties, so this is third-party native code executing, every time.
 */

export class Lv2Scanner {
  constructor ({ sandbox = new Sandbox() } = {}) {
    this.sandbox = sandbox
  }

  /** Plugin IRIs lilv can see in a directory of bundles. */
  async list (mountPath) {
    const run = await this.sandbox.run({
      mountPath,
      command: ['lv2ls'],
      timeoutMs: PROFILER_CONFIG.wallClockLimitMs
    })
    return {
      run,
      uris: run.outcome === OUTCOME.OK
        ? run.stdout.split('\n').map(line => line.trim()).filter(Boolean)
        : []
    }
  }

  /**
   * Parse lv2info's report into measurements.
   *
   * Deliberately conservative: only fields lv2info states plainly are read, and
   * anything unrecognised is left alone rather than guessed at. The output is a
   * human-readable report, not an interchange format, so a parser that tries to
   * be clever about it will be wrong quietly.
   */
  static parse (text) {
    const value = label => {
      const match = text.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, 'm'))
      return match ? match[1].trim() : null
    }

    const ports = []
    // Port blocks are "Port N:" followed by an indented body, until the next
    // Port or the end.
    const blocks = text.split(/^\s*Port \d+:\s*$/m).slice(1)
    for (const block of blocks) {
      const field = label => {
        const match = block.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, 'm'))
        return match ? match[1].trim() : null
      }
      const types = []
      // The terminator must be a *label*, and a label starts with a capital.
      // Matching any word followed by a colon stops at the first continuation
      // URI, because "http:" looks exactly like one — which silently truncated
      // every multi-typed port to its first type, losing the InputPort or
      // OutputPort that says which direction it is.
      const typeMatch = block.match(/^\s*Type:\s*([\s\S]*?)(?=^\s*[A-Z][\w ]*:)/m)
      if (typeMatch) {
        for (const line of typeMatch[1].split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('http')) types.push(trimmed)
        }
      }
      ports.push({
        symbol: field('Symbol'),
        name: field('Name'),
        types,
        minimum: Lv2Scanner.#number(field('Minimum')),
        maximum: Lv2Scanner.#number(field('Maximum')),
        default: Lv2Scanner.#number(field('Default'))
      })
    }

    const uis = [...text.matchAll(/^\s*Class:\s*(http:\/\/lv2plug\.in\/ns\/extensions\/ui#\S+)/gm)]
      .map(match => match[1])

    return {
      name: value('Name'),
      className: value('Class'),
      // lv2info answers "yes" or "no"; anything else is left null rather than
      // coerced to false, because "unknown" and "no" are different claims.
      hasLatency: value('Has latency') === 'yes' ? true : (value('Has latency') === 'no' ? false : null),
      binary: value('Binary'),
      bundle: value('Bundle'),
      requiredFeatures: Lv2Scanner.#uriList(text, 'Required Features'),
      optionalFeatures: Lv2Scanner.#uriList(text, 'Optional Features'),
      uiTypes: uis,
      ports
    }
  }

  static #number (raw) {
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  static #uriList (text, label) {
    const match = text.match(new RegExp(`^\\s*${label}:\\s*([\\s\\S]*?)(?=^\\s*[A-Z][\\w ]*:)`, 'm'))
    if (!match) return []
    return match[1].split('\n').map(line => line.trim()).filter(line => line.startsWith('http'))
  }

  /**
   * Scan one plugin. The run record travels with the reading, because a scan
   * that crashed is a measurement too — and the most interesting one.
   */
  async scan (mountPath, uri) {
    const run = await this.sandbox.run({
      mountPath,
      command: ['lv2info', uri],
      timeoutMs: PROFILER_CONFIG.wallClockLimitMs
    })
    return {
      uri,
      outcome: run.outcome,
      signal: run.signal,
      elapsedMs: run.elapsedMs,
      scanned: run.outcome === OUTCOME.OK ? Lv2Scanner.parse(run.stdout) : null,
      stderr: run.stderr.slice(0, 2000)
    }
  }

  /** Every plugin lilv finds in a directory, scanned one at a time. */
  async scanAll (mountPath) {
    const { run, uris } = await this.list(mountPath)
    if (uris.length === 0) return { listing: run, results: [] }
    const results = []
    for (const uri of uris) results.push(await this.scan(mountPath, uri))
    return { listing: run, results }
  }
}

export default Lv2Scanner
