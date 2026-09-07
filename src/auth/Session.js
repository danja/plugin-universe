import crypto from 'crypto'

/**
 * Sessions, as a signed cookie and nothing else.
 *
 * There is no session table. A cookie carries an account id and an issue time,
 * with an HMAC over both; verifying it is arithmetic, so a request costs no
 * storage and no lookup beyond the account itself. On a host already running a
 * triple store, an embedding server and the application, not adding a fourth
 * thing to keep is worth more than the flexibility a session store would buy.
 *
 * What that costs, stated plainly because it is a real limitation:
 *
 *  - **Sign-out is client-side.** The cookie is cleared, but a copy taken
 *    beforehand stays valid until it expires. Short expiry is the mitigation.
 *  - **There is no "log out my other device".** That needs server-side state.
 *  - **Suspension is not affected**, because it is checked against the account
 *    record on every request rather than baked into the cookie. An admin can
 *    still cut someone off immediately.
 *
 * The secret is therefore the whole security of a session: anyone holding it can
 * mint a cookie for any account, including an admin one. Rotating it signs
 * everybody out, which is the only revocation lever there is.
 */

export class SessionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'SessionError'
  }
}

export const COOKIE_NAME = 'pu_session'

/** Eight hours. Short, because sign-out cannot revoke. */
export const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000

export class Session {
  /**
   * @param {object} options
   * @param {string} options.secret - from SESSION_SECRET. No default: a
   *   predictable signing key is indistinguishable from no signing at all.
   */
  constructor ({ secret, maxAgeMs = DEFAULT_MAX_AGE_MS }) {
    if (!secret) {
      throw new SessionError(
        'Session needs a secret. Generate one with `openssl rand -base64 32` and put it in ' +
        '.env as SESSION_SECRET — see .env.example.'
      )
    }
    if (secret.length < 32) {
      throw new SessionError(
        `SESSION_SECRET is ${secret.length} characters. It signs every session cookie, so a short ` +
        'one is the only mistake available here. 32 bytes, generated not chosen.'
      )
    }
    this.secret = secret
    this.maxAgeMs = maxAgeMs
  }

  static fromEnvironment (options = {}) {
    return new Session({ secret: process.env.SESSION_SECRET, ...options })
  }

  #sign (payload) {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url')
  }

  /**
   * A cookie value for an account.
   * @param {string} accountId
   */
  mint (accountId, issuedAt = Date.now()) {
    if (!accountId) throw new SessionError('A session needs an account id')
    const payload = `${Buffer.from(String(accountId)).toString('base64url')}.${issuedAt}`
    return `${payload}.${this.#sign(payload)}`
  }

  /**
   * The account id a cookie carries, or null.
   *
   * Null for every failure — bad signature, expired, malformed — because the
   * caller's response is the same in each case and telling them apart is only
   * useful to someone probing.
   */
  verify (value, now = Date.now()) {
    if (typeof value !== 'string') return null
    const parts = value.split('.')
    if (parts.length !== 3) return null
    const [encodedId, issuedAt, signature] = parts

    const expected = this.#sign(`${encodedId}.${issuedAt}`)
    // Constant time: a byte-by-byte comparison leaks how much of a forged
    // signature was right, which is enough to construct one.
    const given = Buffer.from(signature)
    const want = Buffer.from(expected)
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null

    const issued = Number(issuedAt)
    if (!Number.isFinite(issued)) return null
    if (now - issued > this.maxAgeMs) return null
    // A cookie issued in the future is either a clock problem or a forgery
    // attempt; neither is a session.
    if (issued - now > 60_000) return null

    const accountId = Buffer.from(encodedId, 'base64url').toString('utf8')
    return accountId || null
  }

  /** The Set-Cookie header value for a new session. */
  cookie (accountId, { secure = true } = {}) {
    const attributes = [
      `${COOKIE_NAME}=${this.mint(accountId)}`,
      'Path=/',
      'HttpOnly',
      // Lax rather than Strict: the OAuth callback is a cross-site navigation
      // back from GitHub, and Strict would drop the cookie on arrival.
      'SameSite=Lax',
      `Max-Age=${Math.floor(this.maxAgeMs / 1000)}`
    ]
    if (secure) attributes.push('Secure')
    return attributes.join('; ')
  }

  /** The Set-Cookie header value that clears a session. */
  clearCookie ({ secure = true } = {}) {
    const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
    if (secure) attributes.push('Secure')
    return attributes.join('; ')
  }
}

/** Parse a Cookie header into a map. Absent or malformed yields an empty one. */
export function parseCookies (header) {
  const cookies = new Map()
  if (typeof header !== 'string') return cookies
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    if (!name) continue
    cookies.set(name, pair.slice(eq + 1).trim())
  }
  return cookies
}

export default Session
