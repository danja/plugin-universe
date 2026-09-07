import { describe, it, expect } from 'vitest'
import Session, { parseCookies, COOKIE_NAME, SessionError } from '../../src/auth/Session.js'
import GitHubOAuth, { OAuthError } from '../../src/auth/GitHubOAuth.js'

/**
 * The session is a signed cookie and nothing else, so the signature is the
 * whole security of it. These are the tests that matter: that a forged or
 * tampered cookie is rejected, and that a valid one is not.
 */

const SECRET = 'a'.repeat(44)

describe('the signing secret', () => {
  it('is required — a predictable key is no signing at all', () => {
    expect(() => new Session({ secret: '' })).toThrow(SessionError)
    expect(() => new Session({ secret: null })).toThrow(SessionError)
  })

  it('is refused when it is too short to be worth having', () => {
    expect(() => new Session({ secret: 'short' })).toThrow(/32 bytes/)
  })
})

describe('minting and verifying', () => {
  const session = new Session({ secret: SECRET })

  it('round-trips an account id', () => {
    const cookie = session.mint('http://purl.org/stuff/plugin-universe/person/github-42-abcd1234')
    expect(session.verify(cookie)).toBe('http://purl.org/stuff/plugin-universe/person/github-42-abcd1234')
  })

  it('rejects a tampered account id', () => {
    // The obvious attack: change who the cookie says you are.
    const cookie = session.mint('account-a')
    const [, issued, signature] = cookie.split('.')
    const forged = `${Buffer.from('account-b').toString('base64url')}.${issued}.${signature}`
    expect(session.verify(forged)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', () => {
    const other = new Session({ secret: 'b'.repeat(44) })
    expect(session.verify(other.mint('account-a'))).toBeNull()
  })

  it('rejects a truncated or malformed cookie', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', null, undefined, 42]) {
      expect(session.verify(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; the length check has to come
    // first or a short signature is a 500 rather than a rejection.
    const cookie = session.mint('account-a')
    const [id, issued] = cookie.split('.')
    expect(() => session.verify(`${id}.${issued}.short`)).not.toThrow()
    expect(session.verify(`${id}.${issued}.short`)).toBeNull()
  })

  it('expires', () => {
    const session = new Session({ secret: SECRET, maxAgeMs: 1000 })
    const cookie = session.mint('account-a', Date.now() - 5000)
    expect(session.verify(cookie)).toBeNull()
  })

  it('rejects a cookie issued in the future', () => {
    const cookie = session.mint('account-a', Date.now() + 600_000)
    expect(session.verify(cookie)).toBeNull()
  })

  it('accepts a little clock skew', () => {
    const cookie = session.mint('account-a', Date.now() + 5_000)
    expect(session.verify(cookie)).toBe('account-a')
  })
})

describe('the cookie itself', () => {
  const session = new Session({ secret: SECRET })

  it('is HttpOnly, Secure and SameSite=Lax', () => {
    const cookie = session.cookie('account-a')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    // Lax, not Strict: the OAuth callback is a cross-site navigation back from
    // GitHub, and Strict would drop the cookie exactly on arrival.
    expect(cookie).toContain('SameSite=Lax')
  })

  it('can drop Secure for local development over http', () => {
    expect(session.cookie('a', { secure: false })).not.toContain('Secure')
  })

  it('clears with an immediate expiry', () => {
    expect(session.clearCookie()).toContain('Max-Age=0')
  })
})

describe('parsing a Cookie header', () => {
  it('finds the session among others', () => {
    const cookies = parseCookies(`other=1; ${COOKIE_NAME}=abc.def.ghi; third=2`)
    expect(cookies.get(COOKIE_NAME)).toBe('abc.def.ghi')
  })

  it('is empty for an absent or malformed header', () => {
    expect(parseCookies(undefined).size).toBe(0)
    expect(parseCookies('').size).toBe(0)
    expect(parseCookies('novalue').size).toBe(0)
  })
})

describe('the OAuth authorize URL', () => {
  const oauth = new GitHubOAuth({
    clientId: 'abc123', clientSecret: 'secret', callbackUrl: 'https://example.invalid/auth/callback'
  })

  it('requests no scopes at all', () => {
    // An OAuth App's permissions are asked for here, not configured on the app.
    // Omitting scope is what makes the request minimal — and what makes it
    // impossible for this application to read an email address.
    const url = new URL(oauth.authorizeUrl('some-state'))
    expect(url.searchParams.has('scope')).toBe(false)
  })

  it('carries the state, which is the CSRF defence for the flow', () => {
    const url = new URL(oauth.authorizeUrl('some-state'))
    expect(url.searchParams.get('state')).toBe('some-state')
    expect(() => oauth.authorizeUrl('')).toThrow(OAuthError)
  })

  it('generates unpredictable state values', () => {
    const values = new Set(Array.from({ length: 50 }, () => GitHubOAuth.newState()))
    expect(values.size).toBe(50)
    expect(GitHubOAuth.newState().length).toBeGreaterThan(32)
  })

  it('is disabled rather than broken when not configured', () => {
    // A read-only deployment is legitimate and should not need an OAuth App.
    const saved = [process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET]
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
    expect(GitHubOAuth.fromEnvironment({ origin: 'https://example.invalid' })).toBeNull()
    if (saved[0]) process.env.GITHUB_CLIENT_ID = saved[0]
    if (saved[1]) process.env.GITHUB_CLIENT_SECRET = saved[1]
  })
})
