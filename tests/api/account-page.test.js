import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { renderAccountPage, layout } from '../../src/api/render.js'
import { TIER, TRUST } from '../../src/auth/Accounts.js'

/**
 * The page where somebody sees what they are paying for.
 *
 * Three states, and **lapsed** is the one worth naming. Without it, somebody
 * whose subscription ended sees something that looks exactly like the free plan
 * and is left to work out for themselves what happened to the placements they
 * were paying for. A billing page that cannot say "this stopped" is a billing
 * page that generates email.
 */

const account = { login: 'danja', trustLevel: TRUST.MODERATOR }
const prices = {
  single: { text: '€10', label: 'Promoted listing, one year' },
  pro: { text: '€99', label: 'Plugin Universe Pro' }
}
const page = plan => renderAccountPage({ account, csrfToken: 't', plan, prices, corpus: 754 })

describe('what each plan state tells you', () => {
  it('offers both ways to buy on the free plan', () => {
    const html = page({ state: 'free' })
    expect(html).toContain('€10')
    expect(html).toContain('€99')
    expect(html).toContain('action="/billing/subscribe"')
  })

  it('says how long is left and when it renews, when paid', () => {
    const html = page({ state: 'paid', endsAt: '2027-09-12T00:00:00Z', daysRemaining: 40 })
    expect(html).toContain('40 days left')
    expect(html).toContain('renews')
    expect(html).toContain('2027-09-12')
    expect(html).toContain('action="/billing/portal"')
  })

  it('says "ends" rather than "renews" for a subscription being cancelled', () => {
    const html = page({ state: 'paid', endsAt: '2027-09-12T00:00:00Z', daysRemaining: 5, cancelling: true })
    expect(html).toContain('ends')
    expect(html).not.toMatch(/renews 2027/)
  })

  it('counts one day in the singular', () => {
    expect(page({ state: 'paid', endsAt: '2026-09-13T00:00:00Z', daysRemaining: 1 }))
      .toContain('1 day left')
  })

  it('says plainly when a plan has lapsed, and what that stopped', () => {
    // The state that would otherwise be indistinguishable from never having
    // subscribed at all.
    const html = page({ state: 'lapsed', endsAt: '2026-08-01T00:00:00Z' })
    expect(html).toContain('ended on 2026-08-01')
    expect(html).toContain('placements it was paying for have stopped')
    expect(html).toContain('Subscribe again')
  })

  it('never shows the subscribe and manage buttons at once', () => {
    for (const plan of [
      { state: 'free' },
      { state: 'paid', endsAt: '2027-01-01T00:00:00Z', daysRemaining: 9 },
      { state: 'lapsed', endsAt: '2026-01-01T00:00:00Z' }
    ]) {
      const html = page(plan)
      const both = html.includes('action="/billing/subscribe"') && html.includes('action="/billing/portal"')
      expect(both, plan.state).toBe(false)
    }
  })

  it('carries a CSRF token on every form it offers', () => {
    for (const plan of [{ state: 'free' }, { state: 'paid', endsAt: '2027-01-01T00:00:00Z', daysRemaining: 9 }, { state: 'lapsed', endsAt: '2026-01-01T00:00:00Z' }]) {
      const html = page(plan)
      const forms = html.match(/<form method="post" action="\/billing\/[^"]*">[\s\S]*?<\/form>/g) ?? []
      expect(forms.length, plan.state).toBeGreaterThan(0)
      for (const form of forms) expect(form, plan.state).toContain('name="csrf"')
    }
  })
})

describe('what the page does not do', () => {
  it('states no price of its own', () => {
    // Prices come from Stripe. A figure typed into a template is a second place
    // for a price to be wrong, which is the failure this integration is built
    // to avoid — and it would go stale silently the day the price changed.
    for (const file of ['templates/account.html', 'templates/account-plan-free.html',
      'templates/account-plan-paid.html', 'templates/account-plan-lapsed.html']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/[€$£]\s?\d/)
    }
  })

  it('renders without prices at all, if Stripe cannot be reached', () => {
    // Somebody opening this page mostly wants to know what they are on. That
    // answer does not depend on Stripe being up.
    const html = renderAccountPage({
      account, csrfToken: 't', plan: { state: 'free' }, prices: {}, corpus: 754
    })
    expect(html).toContain('free plan')
    expect(html).not.toContain('undefined')
  })

  it('promises the catalogue stays free', () => {
    // The thing a paid tier must never appear to threaten.
    expect(page({ state: 'free' })).toMatch(/free and open to everyone/)
  })
})

describe('the page is reachable', () => {
  it('is linked from the account bar, not only by typing the address', () => {
    // The most-repeated failure in this project: a route with nothing linking
    // to it. /billing/subscribe and /billing/portal are reached from here, so
    // this link is what makes the whole paid flow reachable at all.
    expect(readFileSync('templates/account-signed-in.html', 'utf8')).toContain('href="/account"')
  })

  it('appears only for somebody signed in', () => {
    const signedOut = layout('x', '<p>y</p>', { signInEnabled: true, account: null })
    expect(signedOut).not.toContain('href="/account"')
  })
})
