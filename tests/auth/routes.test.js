import { describe, it, expect } from 'vitest'
import AuthRoutes, { safeReturnTo, wantsSecureCookies, STATE_COOKIE } from '../../src/auth/routes.js'
import Session, { COOKIE_NAME } from '../../src/auth/Session.js'
import GitHubOAuth from '../../src/auth/GitHubOAuth.js'

const SECRET = 'a'.repeat(44)
const session = new Session({ secret: SECRET })
const oauth = new GitHubOAuth({
  clientId: 'abc', clientSecret: 'shh', callbackUrl: 'https://example.invalid/auth/callback'
})

/** Accounts, in memory. The store is exercised in the store suite. */
function fakeAccounts (record = null) {
  return {
    find: async iri => (record && record.iri === iri ? record : null),
    upsert: async identity => ({ iri: 'acct-1', suspended: false, ...identity })
  }
}

const request = (headers = {}) => ({ headers: { host: 'plugin-universe.com', ...headers } })
const at = path => new URL(`https://plugin-universe.com${path}`)

describe('where sign-in sends you afterwards', () => {
  it('accepts a path on this site', () => {
    expect(safeReturnTo('/plugin/abc')).toBe('/plugin/abc')
  })

  it('refuses an absolute URL', () => {
    // `?return_to=https://evil.invalid` would make this site a phishing bounce,
    // borrowing its domain to send a victim somewhere else.
    expect(safeReturnTo('https://evil.invalid/')).toBe('/')
  })

  it('refuses a protocol-relative URL', () => {
    // The one that gets missed: `//evil.invalid` is absolute to a browser and
    // looks like a path to a naive check.
    expect(safeReturnTo('//evil.invalid/')).toBe('/')
  })

  it('refuses a backslash, which some browsers normalise to a slash', () => {
    expect(safeReturnTo('/\\evil.invalid')).toBe('/')
  })

  it('falls back for nonsense', () => {
    for (const bad of ['', null, undefined, 42, 'relative/path']) {
      expect(safeReturnTo(bad)).toBe('/')
    }
  })
})

describe('cookie security flag', () => {
  it('is on for a real host', () => {
    expect(wantsSecureCookies('plugin-universe.com')).toBe(true)
  })

  it('is off on localhost, or a dev instance could never hold a session', () => {
    // Secure cookies are not stored over plain http.
    expect(wantsSecureCookies('localhost:4100')).toBe(false)
    expect(wantsSecureCookies('127.0.0.1:4100')).toBe(false)
  })
})

describe('starting the flow', () => {
  const routes = new AuthRoutes({ oauth, session, accounts: fakeAccounts() })

  it('redirects to GitHub with a state', () => {
    const outcome = routes.login(request(), at('/auth/login'))
    expect(outcome.status).toBe(302)
    const url = new URL(outcome.headers.Location)
    expect(url.host).toBe('github.com')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('remembers the state in a signed, HttpOnly cookie', () => {
    const outcome = routes.login(request(), at('/auth/login'))
    const cookie = outcome.headers['Set-Cookie']
    expect(cookie).toContain(STATE_COOKIE)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })

  it('does not let a caller choose an off-site destination', () => {
    const outcome = routes.login(request(), at('/auth/login?return_to=https://evil.invalid'))
    const carried = session.verify(outcome.headers['Set-Cookie'].split('=')[1].split(';')[0])
    expect(carried.split('|')[1]).toBe('/')
  })
})

describe('coming back', () => {
  const routes = new AuthRoutes({ oauth, session, accounts: fakeAccounts() })

  const withState = (state, returnTo = '/') =>
    request({ cookie: `${STATE_COOKIE}=${session.mint(`${state}|${returnTo}`)}` })

  it('refuses when the state does not match', async () => {
    // Without this an attacker completes an authorisation of *their* account in
    // a victim's browser, and the victim is silently signed in as them.
    const outcome = await routes.callback(withState('expected'), at('/auth/callback?code=x&state=forged'))
    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatch(/state did not match/)
  })

  it('refuses when there is no state cookie at all', async () => {
    const outcome = await routes.callback(request(), at('/auth/callback?code=x&state=anything'))
    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatch(/did not start here/)
  })

  it('refuses a state cookie signed with another secret', async () => {
    const other = new Session({ secret: 'b'.repeat(44) })
    const forged = request({ cookie: `${STATE_COOKIE}=${other.mint('s|/')}` })
    const outcome = await routes.callback(forged, at('/auth/callback?code=x&state=s'))
    expect(outcome.status).toBe(400)
  })

  it('reports an error GitHub sends back', async () => {
    const outcome = await routes.callback(
      withState('s'), at('/auth/callback?error=access_denied&error_description=User+said+no'))
    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatch(/User said no/)
  })
})

describe('the account on a request', () => {
  const account = { iri: 'acct-1', login: 'ada', suspended: false }
  const routes = new AuthRoutes({ oauth, session, accounts: fakeAccounts(account) })

  it('is found from a valid cookie', async () => {
    const req = request({ cookie: `${COOKIE_NAME}=${session.mint('acct-1')}` })
    expect((await routes.currentAccount(req))?.login).toBe('ada')
  })

  it('is nobody without a cookie', async () => {
    expect(await routes.currentAccount(request())).toBeNull()
  })

  it('is nobody when the cookie is forged', async () => {
    const other = new Session({ secret: 'b'.repeat(44) })
    const req = request({ cookie: `${COOKIE_NAME}=${other.mint('acct-1')}` })
    expect(await routes.currentAccount(req)).toBeNull()
  })

  it('is nobody when the account is suspended, cookie or no cookie', async () => {
    // The point of checking the record rather than the cookie: sessions are
    // stateless and cannot be revoked, so suspension has to bite here.
    const suspended = new AuthRoutes({
      oauth, session, accounts: fakeAccounts({ ...account, suspended: true })
    })
    const req = request({ cookie: `${COOKIE_NAME}=${session.mint('acct-1')}` })
    expect(await suspended.currentAccount(req)).toBeNull()
  })
})

describe('signing out', () => {
  const routes = new AuthRoutes({ oauth, session, accounts: fakeAccounts() })

  it('clears the cookie and goes home', () => {
    const outcome = routes.logout(request())
    expect(outcome.status).toBe(302)
    expect(outcome.headers.Location).toBe('/')
    expect(outcome.headers['Set-Cookie']).toContain('Max-Age=0')
  })
})
