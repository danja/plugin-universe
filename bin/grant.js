#!/usr/bin/env node
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import Accounts, { TRUST, TIER } from '../src/auth/Accounts.js'

/**
 * Set an account's trust level, tier or suspension, from the server.
 *
 * There is no web route that makes the first moderator, and there should not
 * be: every such route is a privilege-escalation bug waiting to be found. The
 * only way to create one is to have shell access to the machine, which is the
 * correct bar. Later moderators can be made by an existing one through the
 * moderation page, but the first is made here.
 *
 * Usage:
 *   node bin/grant.js --list
 *   node bin/grant.js --login danja --trust moderator
 *   node bin/grant.js --login someone --tier admin
 *   node bin/grant.js --login spammer --suspend
 *   node bin/grant.js --login someone --unsuspend
 */

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const accounts = new Accounts(client)

if (args.includes('--list') || args.length === 0) {
  const all = await accounts.list()
  if (all.length === 0) {
    console.log('No accounts yet. Somebody has to sign in before they can be granted anything.')
    process.exit(0)
  }
  console.log(`${all.length} account(s):\n`)
  for (const account of all) {
    console.log(
      `  ${account.login.padEnd(20)} ${account.trustLevel.padEnd(10)} ${account.tier.padEnd(11)}` +
      `${account.suspended ? ' SUSPENDED' : ''}`
    )
  }
  if (!all.some(a => a.trustLevel === TRUST.MODERATOR)) {
    console.log('\nNo moderator yet, so nothing can be reviewed and the queue only grows:')
    console.log(`  node bin/grant.js --login ${all[0].login} --trust moderator`)
  }
  process.exit(0)
}

const login = flag('login')
if (!login) {
  console.error('Which account? --login <github-login>, or --list to see them.')
  process.exit(1)
}

const all = await accounts.list()
const account = all.find(a => a.login === login)
if (!account) {
  console.error(`No account for "${login}". They must sign in once before they exist.`)
  console.error(`Known: ${all.map(a => a.login).join(', ') || '(none)'}`)
  process.exit(1)
}

let changed = false
const trust = flag('trust')
if (trust) {
  await accounts.setTrust(account.iri, trust)
  console.log(`${login}: trust ${account.trustLevel} → ${trust}`)
  changed = true
}
const tier = flag('tier')
if (tier) {
  await accounts.setTier(account.iri, tier)
  console.log(`${login}: tier ${account.tier} → ${tier}`)
  changed = true
}
if (args.includes('--suspend')) {
  await accounts.setSuspended(account.iri, true)
  console.log(`${login}: suspended. Their session stays valid but every request is refused.`)
  changed = true
}
if (args.includes('--unsuspend')) {
  await accounts.setSuspended(account.iri, false)
  console.log(`${login}: no longer suspended.`)
  changed = true
}

if (!changed) {
  console.error(
    `Nothing to do. --trust <${Object.values(TRUST).join('|')}>, ` +
    `--tier <${Object.values(TIER).join('|')}>, --suspend, --unsuspend`
  )
  process.exit(1)
}
