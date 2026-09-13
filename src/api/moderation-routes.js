import logger from 'loglevel'
import { send, sendText, redirect, needsSignIn, HTML } from './respond.js'
import { renderContributionsPage, renderAdminPage } from './render.js'
import { readForm } from './body.js'
import { ACTIONS, runAction } from './AdminActions.js'
import { CORRECTABLE, CorrectionError } from '../contrib/Corrections.js'
import { SubmissionError } from '../contrib/Submissions.js'
import { FeedbackError } from '../contrib/Feedback.js'
import { PromotionError, daysRemaining } from '../catalogue/Promotions.js'
import { PROMOTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { TRUST, AccountError } from '../auth/Accounts.js'
import { vendorKey } from '../search/SearchService.js'

/**
 * The queue, and the console above it.
 *
 * `/contributions` is what one contributor has offered; `/admin` is where a
 * moderator decides. Together they were 220 lines of `server.js` and the single
 * largest thing in it.
 *
 * `/admin` does four unrelated jobs — review a correction or submission,
 * confirm a vendor claim, place or end a promotion, run a maintenance action —
 * and the reason they share a page is that they share an audience. They do not
 * share much else, so each is its own function here and the router below only
 * decides which the form is asking for.
 */

/** The paths this module answers. */
const PATHS = new Set(['/contributions', '/moderation', '/admin'])

export async function moderationRoutes (context) {
  const { response, path, auth, corrections } = context
  if (!PATHS.has(path)) return false

  // Moved. Every moderator's bookmark and the account bar's old link still
  // work, and there is one page rather than two that drift.
  if (path === '/moderation') {
    redirect(response, '/admin')
    return true
  }

  if (!auth || !corrections) {
    send(response, 404, {
      error: path === '/contributions' ? 'Contributions are not enabled' : 'Moderation is not enabled'
    })
    return true
  }

  if (path === '/contributions') {
    await contributionsPage(context)
    return true
  }
  await adminConsole(context)
  return true
}

/** A contributor's own list of what they have offered. */
async function contributionsPage ({ request, response, viewer, corrections }) {
  // 401, not 404: unlike the moderation queue this is not a role anyone might
  // not have — it is simply nobody's page until you sign in, and saying so is
  // the useful answer.
  if (!viewer.account) {
    return needsSignIn(request, response, {
      returnTo: '/contributions',
      message: 'Sign in to see your contributions'
    })
  }
  const rows = await corrections.byAccount(viewer.account.iri)
  return sendText(response, 200, renderContributionsPage(rows, {
    viewer,
    correctable: CORRECTABLE,
    trustLevel: viewer.account.trustLevel
  }), HTML)
}

async function adminConsole (context) {
  const { request, response, viewer, auth } = context
  const moderator = viewer.account
  // Not 403 for a signed-out visitor: the existence of the queue is not a
  // secret, but nor is it worth telling a stranger they lack a role.
  if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
    return send(response, 404, { error: 'No such endpoint', path: '/admin' })
  }

  let message = null
  if (request.method === 'POST') {
    let form
    try {
      form = await readForm(request)
    } catch (error) {
      return send(response, error.status ?? 400, { error: error.message })
    }
    if (!auth.session.verifyCsrf(form.get('csrf'), moderator.iri)) {
      return send(response, 403, { error: 'That page has expired. Reload and try again.' })
    }
    message = await actOn(form, context, moderator)
  }

  return sendText(response, 200, await adminPage(context, moderator, message), HTML)
}

/**
 * What the form was asking for, done.
 *
 * Which job this is, is decided by which field the form carried rather than by
 * a mode the page has to remember.
 */
async function actOn (form, context, moderator) {
  if (form.get('markread')) return markRead(form, context, moderator)
  if (form.get('claim') || form.get('unclaim')) return vendorClaim(form, context, moderator)
  if (form.get('promote') || form.get('unpromote')) return placement(form, context, moderator)
  if (form.get('action')) return maintenance(form, context)
  return review(form, context, moderator)
}

/**
 * Mark a message to the moderators as dealt with.
 *
 * The only thing that can be done to one from this page. There is nothing to
 * apply and nothing to publish, so "read" is the whole of its state — see
 * `src/contrib/Feedback.js`.
 */
async function markRead (form, { feedback }, moderator) {
  if (!feedback) return 'Feedback is not enabled.'
  try {
    await feedback.markRead({ feedbackIri: form.get('feedback'), moderator })
    return 'Marked read. It stays in the store, attributed and dated, and is gone if that account is erased.'
  } catch (error) {
    if (!(error instanceof FeedbackError)) throw error
    return error.message
  }
}

/**
 * Confirm or withdraw a vendor claim.
 *
 * What turns a Pro subscription from "promote anything" into "promote your
 * own", and deliberately a moderator's decision — see `claimVendor`.
 */
async function vendorClaim (form, { auth, search }, moderator) {
  const login = String(form.get('login') ?? '').trim()
  const target = (await auth.accounts.list()).find(a => a?.login === login)
  if (!target) return `No account with the login "${login}".`
  try {
    if (form.get('unclaim')) {
      await auth.accounts.releaseVendor(target.iri, moderator)
      return `${login} no longer speaks for any vendor.`
    }
    const key = vendorKey(String(form.get('vendor') ?? ''))
    const vendor = search.vendor(key)
    if (!vendor) return `No vendor in the catalogue folds to "${key}".`
    await auth.accounts.claimVendor(target.iri, vendor.key ?? key, moderator)
    return `${login} now speaks for ${vendor.name} — ` +
      `${vendor.count} plugin${vendor.count === 1 ? '' : 's'}, promotable on a Pro subscription.`
  } catch (error) {
    if (!(error instanceof AccountError)) throw error
    return error.message
  }
}

/**
 * Place or end a promotion.
 *
 * Separate from the action table because both take a subject, and the action
 * table is deliberately a list of verbs that take none.
 */
async function placement (form, { search, promotions }, moderator) {
  if (!promotions) return 'Promotion is not enabled.'
  const slug = String(form.get('slug') ?? '').trim().replace(/^.*\/plugin\//, '')
  const pluginIri = `${NAMESPACES.pu}plugin/${slug}`
  const doc = search.documents.get(pluginIri)
  if (!doc) {
    return `No plugin with the slug "${slug}". It is the last part of the plugin page's address.`
  }
  try {
    let message
    if (form.get('promote')) {
      const result = await promotions.promote({ moderator, pluginIri })
      message = result.created
        ? `${doc.name} is promoted until ${String(result.endsAt).slice(0, 10)}. Its results now carry a Promoted label.`
        : `${doc.name} was already promoted, until ${String(result.endsAt).slice(0, 10)}. Nothing changed — pressing the button twice does not extend a placement.`
    } else {
      const result = await promotions.unpromote({ moderator, pluginIri })
      message = result.ended
        ? `${doc.name} is no longer promoted. The record is kept, ended as of now.`
        : `${doc.name} was not promoted. Nothing to end.`
    }
    // The ranking reads a map held in memory, so a placement that needed a
    // restart to take effect would be one the moderator believes is running
    // when it is not.
    await search.loadPromotions()
    return message
  } catch (error) {
    if (!(error instanceof PromotionError)) throw error
    return error.message
  }
}

/**
 * A maintenance action.
 *
 * The action's *name* is a key into a frozen table and never reaches a shell, a
 * filename or a graph name — see `src/api/AdminActions.js`.
 */
async function maintenance (form, { search, config }) {
  const name = form.get('action')
  try {
    return await runAction(name, { client: search.client, config, search })
  } catch (error) {
    // Shown rather than turned into a 500: the administrator pressed the button
    // and is owed the answer. runAction has already translated the common
    // causes into a remedy.
    logger.warn(`[admin] ${name} failed: ${error.message}`)
    return `${name} failed: ${error.message}`
  }
}

/**
 * Accept or reject one queued thing.
 *
 * One queue, two kinds of thing in it, told apart by which field the form
 * carried.
 */
async function review (form, { search, auth, corrections, submissions }, moderator) {
  const accept = form.get('decision') === 'accept'
  try {
    const outcome = form.get('submission')
      ? await submissions.review({
        submissionIri: form.get('submission'), moderator, accept, accounts: auth.accounts
      })
      : await corrections.review({
        correctionIri: form.get('correction'), moderator, accept, accounts: auth.accounts
      })
    // An accepted submission is a plugin the running app has never heard of:
    // documents are read at startup and the vector index is a file. Without
    // this it is in the catalogue, dereferenceable at its own IRI, and absent
    // from every search.
    const taken = outcome.status === 'accepted' && form.get('submission')
      ? await search.takeUpNewPlugins()
      : null
    return outcome.status === 'accepted'
      ? `Accepted.${outcome.promoted ? ` ${outcome.contributor} is now trusted — their contributions go live from here.` : ''}` +
        (taken?.error ? ' It is in the catalogue but not yet searchable — indexing failed, and the nightly run will pick it up.' : '') +
        (taken?.embedded ? ` Indexed and searchable — ${taken.plugins} plugins.` : '')
      : 'Rejected. Nothing was written to a public graph.'
  } catch (error) {
    if (!(error instanceof CorrectionError) && !(error instanceof SubmissionError)) throw error
    return error.message
  }
}

/**
 * The page, read fresh every time — including after a POST.
 *
 * A moderator who has just promoted something must see it in the list, or they
 * will press the button again.
 *
 * This was written out **four times** in `server.js`, once per branch, and the
 * copies had already drifted: the promote branch omitted `claims`, so confirming
 * a vendor claim and then promoting a plugin made the claims panel disappear.
 * One function cannot do that.
 */
async function adminPage ({
  viewer, auth, search, corrections, submissions, promotions, billing, feedback
}, moderator, message) {
  const promotionState = async () => {
    if (!promotions) return null
    const live = [...(await promotions.active()).values()]
      .map(row => ({
        ...row,
        name: search.documents.get(row.plugin)?.name ?? null,
        daysRemaining: daysRemaining(row)
      }))
    return {
      live,
      expiring: live.filter(row => row.daysRemaining <= PROMOTION_CONFIG.expiringWithinDays)
    }
  }
  // A message carries the IRI of whoever wrote it; a moderator needs the login.
  // Resolved here rather than joined in the query, because the accounts live in
  // a graph of their own and a message deliberately holds nothing about a
  // person beyond the pointer.
  const feedbackState = async () => {
    if (!feedback) return null
    const rows = await feedback.pending()
    if (rows.length === 0) return rows
    const logins = new Map((await auth.accounts.list()).filter(Boolean).map(a => [a.iri, a.login]))
    return rows.map(row => ({ ...row, login: logins.get(row.by) ?? row.by }))
  }

  // Only where there is a paid tier for a claim to entitle.
  const claimState = async () => {
    if (!billing) return null
    const all = await auth.accounts.list()
    return { count: all.filter(a => a?.claimsVendor).length }
  }

  return renderAdminPage(await corrections.pending(), {
    csrfToken: auth.session.csrfToken(moderator.iri),
    message,
    viewer,
    submissions: submissions ? await submissions.pending() : [],
    actions: ACTIONS,
    facetValues: await search.facets(),
    corpus: search.documents.size,
    promotions: await promotionState(),
    claims: await claimState(),
    feedback: await feedbackState()
  })
}

export default moderationRoutes
