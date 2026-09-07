import crypto from 'crypto'
import logger from 'loglevel'
import { HARVEST_CONFIG } from '../../config/preferences.js'

/**
 * Sign-in through GitHub, and nothing more.
 *
 * The OAuth App requests **no scopes**. That still returns a login, a numeric
 * id, a display name and an avatar from `/user`, and it deliberately cannot
 * read an email address — the standing rule is that an email is not catalogue
 * data, and the surest way to keep a rule is to be unable to break it. The
 * consent screen a user sees says "verify your GitHub identity" rather than
 * listing permissions, which is the least this project could ask for.
 *
 * The access token is used once, to call `/user`, and then discarded. Identity
 * is all that is wanted; keeping the token would be holding a credential for no
 * reason and would turn a compromise of this store into a compromise of other
 * people's GitHub accounts.
 *
 * `state` is not optional. It is the CSRF defence for the flow itself: without
 * it an attacker can complete an authorisation of their own account in a
 * victim's browser, and the victim ends up signed in as them.
 */

const AUTHORIZE = 'https://github.com/login/oauth/authorize'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'

export class OAuthError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'OAuthError'
    if (cause) this.cause = cause
  }
}

export class GitHubOAuth {
  constructor ({ clientId, clientSecret, callbackUrl }) {
    for (const [key, value] of Object.entries({ clientId, clientSecret, callbackUrl })) {
      if (!value) throw new OAuthError(`GitHubOAuth needs ${key}`)
    }
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.callbackUrl = callbackUrl
  }

  /**
   * Build from the environment, or null when sign-in is not configured.
   *
   * Null rather than an error: a read-only deployment of this catalogue is a
   * legitimate thing to run, and it should not require an OAuth App. The server
   * mounts the auth routes only when this returns something, so the absence is
   * explicit rather than a silent fallback.
   */
  static fromEnvironment ({ origin } = {}) {
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      logger.info('[auth] GITHUB_CLIENT_ID/SECRET not set; sign-in is disabled')
      return null
    }
    if (!origin) throw new OAuthError('GitHubOAuth.fromEnvironment needs the site origin')
    return new GitHubOAuth({
      clientId,
      clientSecret,
      callbackUrl: `${origin.replace(/\/$/, '')}/auth/callback`
    })
  }

  /** A random value to carry through the flow and check on the way back. */
  static newState () {
    return crypto.randomBytes(32).toString('base64url')
  }

  /**
   * Where to send the browser.
   *
   * No `scope` parameter, deliberately — see the note above. An OAuth App's
   * permissions are asked for here, not configured on the app, so omitting this
   * is what makes the request minimal.
   */
  authorizeUrl (state) {
    if (!state) throw new OAuthError('An authorize URL needs a state value')
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      state,
      allow_signup: 'true'
    })
    return `${AUTHORIZE}?${params}`
  }

  /** Exchange the callback's code for an access token. */
  async exchange (code) {
    if (!code) throw new OAuthError('No code to exchange')
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': HARVEST_CONFIG.userAgent
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.callbackUrl
      }),
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new OAuthError(`GitHub returned HTTP ${response.status} exchanging the code`)
    }
    const body = await response.json()
    // GitHub reports failure with a 200 and an error field, so the status alone
    // is not the check.
    if (body.error) {
      throw new OAuthError(`GitHub refused the code: ${body.error_description ?? body.error}`)
    }
    if (!body.access_token) throw new OAuthError('GitHub returned no access token')
    return body.access_token
  }

  /**
   * Who the token belongs to.
   *
   * Only the public fields are taken, and the token is not returned to the
   * caller — it has no further use and this is where it stops.
   */
  async identify (token) {
    const response = await fetch(USER, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': HARVEST_CONFIG.userAgent
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new OAuthError(`GitHub returned HTTP ${response.status} identifying the user`)
    }
    const body = await response.json()
    if (!body.id || !body.login) throw new OAuthError('GitHub returned no identity')
    return {
      githubId: String(body.id),
      login: body.login,
      // May be null: plenty of people set no display name.
      name: body.name ?? null,
      avatarUrl: body.avatar_url ?? null
    }
  }

  /** The whole callback leg: code in, identity out, token discarded. */
  async identifyFromCode (code) {
    const token = await this.exchange(code)
    try {
      return await this.identify(token)
    } finally {
      // Nothing to revoke — the token was never stored — but be explicit that
      // this is where it goes out of scope, because "we keep no token" is a
      // claim made in the contributor terms.
      logger.debug('[auth] access token discarded after identification')
    }
  }
}

export default GitHubOAuth
