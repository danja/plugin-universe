import Session, { parseCookies, COOKIE_NAME } from './Session.js'
import GitHubOAuth from './GitHubOAuth.js'
import logger from 'loglevel'

/**
 * The sign-in routes.
 *
 * Three of them — start, come back, leave — plus the per-request work of
 * turning a cookie into an account.
 *
 * The `state` round trip is the CSRF defence for the OAuth flow itself, and it
 * needs somewhere to live between the redirect out and the redirect back. It
 * goes in a short-lived signed cookie of its own rather than in a server-side
 * map, for the same reason the session does: no store to keep, and a value that
 * cannot be forged without the secret.
 */

export const STATE_COOKIE = 'pu_oauth_state'

/** Five minutes is longer than any honest authorisation takes. */
const STATE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * Where to send someone after signing in.
 *
 * Only a path on this site. An absolute URL, or anything starting `//`, would
 * make `?return_to=` an open redirect — a phishing primitive that borrows this
 * site's domain to bounce a victim somewhere else, and one of the easiest things
 * to leave in by accident.
 */
export function safeReturnTo (value, fallback = '/') {
  if (typeof value !== 'string' || value === '') return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  return value
}

/**
 * Whether cookies should carry `Secure`.
 *
 * True everywhere except a local development host: `Secure` cookies are not
 * stored over plain http, so a dev instance on localhost could never hold a
 * session. Behind nginx the app sees http on the loopback, so the request's own
 * protocol is not the thing to test — the host is.
 */
export function wantsSecureCookies (host) {
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(host ?? ''))
}

export class AuthRoutes {
  /**
   * @param {object} deps
   * @param {GitHubOAuth|null} deps.oauth - null disables sign-in entirely
   * @param {Session} deps.session
   * @param {Accounts} deps.accounts
   */
  constructor ({ oauth, session, accounts }) {
    this.oauth = oauth
    this.session = session
    this.accounts = accounts
  }

  static fromEnvironment ({ accounts, origin }) {
    const oauth = GitHubOAuth.fromEnvironment({ origin })
    if (!oauth) return null
    return new AuthRoutes({ oauth, session: Session.fromEnvironment(), accounts })
  }

  /**
   * The account making this request, or null.
   *
   * Suspension is checked here, against the record, on every request. That is
   * what lets a stateless session coexist with immediate suspension: the cookie
   * stays valid, and the account it names does not.
   */
  async currentAccount (request) {
    const cookies = parseCookies(request.headers.cookie)
    const accountIri = this.session.verify(cookies.get(COOKIE_NAME))
    if (!accountIri) return null
    const account = await this.accounts.find(accountIri)
    if (!account) return null
    if (account.suspended) return null
    return account
  }

  /** Begin: mint a state, remember it, send the browser to GitHub. */
  login (request, url) {
    const state = GitHubOAuth.newState()
    const returnTo = safeReturnTo(url.searchParams.get('return_to'))
    const secure = wantsSecureCookies(request.headers.host)

    // The state cookie carries the return path too, so an attacker cannot
    // substitute their own destination for the victim's.
    const payload = this.session.mint(`${state}|${returnTo}`)
    const attributes = [
      `${STATE_COOKIE}=${payload}`,
      'Path=/auth',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${STATE_MAX_AGE_MS / 1000}`
    ]
    if (secure) attributes.push('Secure')

    return {
      status: 302,
      headers: { Location: this.oauth.authorizeUrl(state), 'Set-Cookie': attributes.join('; ') }
    }
  }

  /** Return: check the state, exchange the code, sign in. */
  async callback (request, url) {
    const secure = wantsSecureCookies(request.headers.host)
    const cookies = parseCookies(request.headers.cookie)
    const carried = this.session.verify(cookies.get(STATE_COOKIE))

    const failure = reason => {
      logger.warn(`[auth] callback rejected: ${reason}`)
      return { status: 400, body: `Sign-in failed: ${reason}. Start again from /auth/login.` }
    }

    if (url.searchParams.get('error')) {
      return failure(url.searchParams.get('error_description') ?? url.searchParams.get('error'))
    }
    if (!carried) return failure('the sign-in did not start here, or it took too long')

    const [expectedState, returnTo] = carried.split('|')
    const given = url.searchParams.get('state')
    // Without this check an attacker can complete an authorisation of their own
    // account inside a victim's browser, and the victim ends up signed in as
    // them — able to see, and be blamed for, whatever that account does.
    if (!given || given !== expectedState) return failure('the state did not match')

    let identity
    try {
      identity = await this.oauth.identifyFromCode(url.searchParams.get('code'))
    } catch (error) {
      return failure(error.message)
    }

    const account = await this.accounts.upsert(identity)
    if (account.suspended) {
      return { status: 403, body: 'This account is suspended.' }
    }

    return {
      status: 302,
      headers: {
        Location: safeReturnTo(returnTo),
        'Set-Cookie': [
          this.session.cookie(account.iri, { secure }),
          // Spend the state cookie; it is good for one flow.
          `${STATE_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0`
        ]
      }
    }
  }

  /**
   * Leave.
   *
   * POST, not GET: a plain link would let any page log a visitor out with an
   * `<img>`. Low harm, but it costs one form to do properly.
   *
   * This clears the cookie in the browser. It cannot invalidate a copy taken
   * beforehand — that is the stated cost of a stateless session, and the
   * mitigation is the short expiry.
   */
  logout (request) {
    return {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': this.session.clearCookie({ secure: wantsSecureCookies(request.headers.host) })
      }
    }
  }
}

export default AuthRoutes
