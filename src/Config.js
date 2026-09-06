import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')

/**
 * Layered configuration: config/config.json, with ${VAR} placeholders resolved
 * from the environment (and from .env, loaded here so no dependency is needed).
 *
 * There are no inline fallbacks. A ${VAR} with nothing behind it is an error,
 * because a config value that silently becomes undefined produces behaviour
 * nobody chose.
 */
export class ConfigError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ConfigError'
  }
}

function loadDotEnv (root) {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function interpolate (value, trail) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
      const resolved = process.env[name]
      if (resolved === undefined || resolved === '') {
        throw new ConfigError(
          `Environment variable ${name} is required by config key "${trail}" but is not set. ` +
          'Copy .env.example to .env and fill it in.'
        )
      }
      return resolved
    })
  }
  if (Array.isArray(value)) return value.map((v, i) => interpolate(v, `${trail}[${i}]`))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, trail ? `${trail}.${k}` : k)
    return out
  }
  return value
}

export class Config {
  constructor (data) {
    this.data = data
  }

  /**
   * @param {string} [configPath] - defaults to PLUGIN_UNIVERSE_CONFIG or config/config.json
   */
  static load (configPath) {
    loadDotEnv(PROJECT_ROOT)
    const target = configPath || process.env.PLUGIN_UNIVERSE_CONFIG || path.join(PROJECT_ROOT, 'config/config.json')
    if (!fs.existsSync(target)) {
      throw new ConfigError(`Config file not found: ${target}`)
    }
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    } catch (error) {
      throw new ConfigError(`Config file ${target} is not valid JSON: ${error.message}`)
    }
    return new Config(interpolate(parsed, ''))
  }

  /**
   * Dotted-path lookup. Throws if the key is absent — callers that want to
   * branch on presence should say so explicitly with has().
   */
  get (keyPath) {
    let current = this.data
    for (const part of keyPath.split('.')) {
      if (current === null || typeof current !== 'object' || !(part in current)) {
        throw new ConfigError(`Missing required config key: ${keyPath}`)
      }
      current = current[part]
    }
    return current
  }

  has (keyPath) {
    try {
      this.get(keyPath)
      return true
    } catch {
      return false
    }
  }

  static get projectRoot () {
    return PROJECT_ROOT
  }
}

export default Config
