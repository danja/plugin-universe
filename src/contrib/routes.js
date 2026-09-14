import { send, sendText, redirect, needsSignIn, HTML } from '../api/respond.js'
import {
  renderSubmitPage, renderProfilePastePage, renderPluginPage, renderFeedbackPage
} from '../api/render.js'
import { readForm, readMultipart, BodyError, MAX_BODY_BYTES } from '../api/body.js'
import { ImageError } from '../api/ImageStore.js'
import { IMAGE_CONFIG, CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { TRUST } from '../auth/Accounts.js'
import { CORRECTABLE, CorrectionError } from './Corrections.js'
import { SUBMITTABLE, SubmissionError } from './Submissions.js'
import { profileTurtle, readProfile, ProfileError } from './ProfileDocument.js'
import { PageReadError } from './PageReader.js'
import { FeedbackError } from './Feedback.js'

/**
 * The three ways a person adds to the catalogue.
 *
 * Submitting a plugin, correcting a fact about one, and adding a picture of
 * one. They are the only routes that write catalogue data on behalf of
 * somebody, so every guard lives here: signed in, not suspended, a CSRF token
 * bound to that account, and — for a correction — a predicate from the
 * whitelist. What the value itself may be is the validator's question.
 *
 * Lifted out of `server.js` along the seam `src/wiki/routes.js` and
 * `src/billing/routes.js` already marked, and answering the same contract:
 * `(context) => boolean`, true meaning the request was answered here.
 */

/** A profile's filename, from the plugin's name. Never empty, never a path. */
function profileFilename (name) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60)
  return slug ? `${slug}-profile.ttl` : 'profile.ttl'
}

const SUBMIT_PATH = '/submit'
// The paste box, on a page of its own. A GET page holding a form that posts to
// `/submit`: the drafting, the validation and the write all stay where they
// were, and this adds an address rather than a second way in.
const PROFILE_PATH = '/submit/profile'
const FEEDBACK_PATH = '/feedback'
const IMAGE_PATH = /^\/plugin\/([A-Za-z0-9-]+)\/image$/
const CORRECT_PATH = /^\/plugin\/([A-Za-z0-9-]+)\/correct$/

export async function contributionRoutes (context) {
  const { path } = context
  if (path === SUBMIT_PATH) return submitRoute(context)
  if (path === PROFILE_PATH) return profilePasteRoute(context)
  if (path === FEEDBACK_PATH) return feedbackRoute(context)

  const picturing = path.match(IMAGE_PATH)
  if (picturing) return imageRoute(context, picturing[1])

  const correcting = path.match(CORRECT_PATH)
  if (correcting) return correctionRoute(context, correcting[1])

  return false
}

/**
 * The paste box for a profile somebody already has.
 *
 * A page of its own because it is a different act from filling in a form:
 * somebody arriving here has written the file already, and putting a
 * twelve-field form in front of them first is asking them to do the work twice.
 * It is also the page to send an author to — an address that says what it is
 * for, rather than "scroll down on /submit".
 *
 * **GET only.** The form on it posts to `/submit`, which drafts it and renders
 * the filled-in form exactly as before. Nothing about writing moved: one
 * validator, one set of shapes, one serialiser, and the ordinary Submit button
 * is still what saves.
 */
async function profilePasteRoute ({ request, response, viewer, auth, search, submissions }) {
  if (!submissions) {
    send(response, 404, { error: 'Submissions are not enabled on this instance' })
    return true
  }
  if (!viewer.account) {
    needsSignIn(request, response, {
      returnTo: PROFILE_PATH,
      message: 'Sign in to submit a profile'
    })
    return true
  }
  sendText(response, 200, renderProfilePastePage({
    csrfToken: auth.session.csrfToken(viewer.account.iri),
    viewer,
    facetValues: await search.facets(),
    corpus: search.documents.size
  }), HTML)
  return true
}

/**
 * Submitting a plugin, and — for a moderator — drafting one from a URL.
 */
async function submitRoute ({
  request, response, viewer, auth, search, submissions, submittable, pageReader
}) {
  if (!submissions) {
    send(response, 404, { error: 'Submissions are not enabled on this instance' })
    return true
  }
  if (!viewer.account) {
    needsSignIn(request, response, {
      returnTo: SUBMIT_PATH,
      message: 'Sign in to submit a plugin'
    })
    return true
  }
  const account = viewer.account
  const facetValues = await search.facets()
  // Moderators only, and checked here as well as in the renderer: the form not
  // being drawn is a decision about a page, not a control. docs/sources.md §4
  // rule 8 — the request has to stay attributable to a named person, or it is
  // an open proxy.
  const mayRead = account.trustLevel === TRUST.MODERATOR
  const render = extra => sendText(response, extra.status ?? 200,
    renderSubmitPage(submittable, {
      csrfToken: auth.session.csrfToken(account.iri),
      viewer,
      facetValues,
      corpus: search.documents.size,
      mayRead,
      ...extra
    }), HTML)

  if (request.method !== 'POST') {
    render({})
    return true
  }

  let form
  try {
    // Larger than the 16 KB default, because one field on this form is a whole
    // profile document. The bound is `maxProfileLength` plus room for the rest
    // of the form, so somebody who pastes something too long meets the message
    // that names profiles rather than a body cap that says nothing about them.
    form = await readForm(request, { limit: CONTRIBUTION_CONFIG.maxProfileLength + MAX_BODY_BYTES })
  } catch (error) {
    send(response, error.status ?? 400, { error: error.message })
    return true
  }
  if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
    send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
    return true
  }

  // Whatever was typed, so an error hands the form back filled in rather than
  // empty. A form that empties itself when it refuses is a form people fill in
  // once.
  const values = Object.fromEntries(Object.entries(SUBMITTABLE).map(([name, spec]) =>
    [name, spec.multiple ? form.getAll(name) : (form.get(name) ?? '')]))

  // "Download the profile" — what has been typed, as a file to host.
  //
  // The point of the catalogue is not to be the place these facts live. A
  // profile beside the author's own plugin is versioned with it, editable by
  // them and readable by anything that speaks RDF; a row in somebody else's
  // database is a copy going stale. So the form doubles as a way of writing the
  // file, and this writes nothing to the store — it is a serialisation of the
  // fields in front of them.
  if (form.get('download')) {
    try {
      const turtle = profileTurtle(values)
      response.writeHead(200, {
        'Content-Type': 'text/turtle; charset=utf-8',
        // Named from the plugin, so somebody downloading three profiles does
        // not get three files called the same thing.
        'Content-Disposition': `attachment; filename="${profileFilename(values.name)}"`,
        'X-Content-Type-Options': 'nosniff'
      })
      response.end(turtle)
    } catch (error) {
      if (!(error instanceof ProfileError)) throw error
      render({ error: error.message, values, status: 400 })
    }
    return true
  }

  // "Submit a profile" — a pasted Turtle or JSON-LD document, drafted into the
  // form.
  //
  // Deliberately *not* a second way to write. It fills the form and the
  // ordinary Submit button still saves, through the same validator, the same
  // shapes and the same serialiser — which is the rule that has kept
  // `SUBMITTABLE`, `vocabs/shapes.ttl` and the serialiser in step. A profile
  // that wrote directly would be a second write path with its own opinions
  // about what is valid, and the two would drift.
  if (form.get('readProfile')) {
    const profile = String(form.get('profile') ?? '')
    try {
      const draft = await readProfile(profile, { submittable })
      render({
        // Anything already typed that the profile does not mention is kept, so
        // a half-filled form is not wiped by pasting.
        values: { ...values, ...draft.fields },
        draft,
        profile
      })
    } catch (error) {
      if (!(error instanceof ProfileError)) throw error
      // Back to the page they pasted on, with the text still in the box. The
      // form is on `/submit/profile` now, so reporting the error on `/submit`
      // would show the message beside no textarea and lose what they pasted —
      // and a profile is not something anybody retypes.
      sendText(response, 400, renderProfilePastePage({
        csrfToken: auth.session.csrfToken(account.iri),
        viewer,
        facetValues,
        corpus: search.documents.size,
        error: error.message,
        profile
      }), HTML)
    }
    return true
  }

  // "Read the page" — one fetch, at this moderator's request, into a draft they
  // then check. It writes nothing: the draft comes back as a filled-in form and
  // the ordinary Submit button is still what saves it. See
  // src/contrib/PageReader.js for the four refusals that keep this from being a
  // crawler.
  if (form.get('read')) {
    const pageUrl = String(form.get('pageUrl') ?? '').trim()
    if (!mayRead) {
      send(response, 403, {
        error: 'Reading a page by URL is for moderators. Fill the form in instead.'
      })
      return true
    }
    if (!pageUrl) {
      render({ error: 'Paste the address of the page to read.', values, status: 400 })
      return true
    }
    try {
      const draft = await pageReader.read(pageUrl)
      render({
        // The draft fills the form; anything already typed that the page did
        // not mention is kept, so a half-filled form is not wiped by pressing
        // Read.
        values: { ...values, ...draft.fields },
        draft,
        pageUrl
      })
    } catch (error) {
      if (!(error instanceof PageReadError)) throw error
      render({ error: error.message, values, pageUrl, status: 400 })
    }
    return true
  }

  try {
    const result = await submissions.submit({ account, fields: values })
    // Written straight into the catalogue for a trusted contributor, so it has
    // to reach the index now or it is a plugin nobody can find. Never throws; a
    // failure here leaves it for the nightly --only-new and says so in the log.
    if (result.status === 'accepted') await search.takeUpNewPlugins()
    render({
      submitted: result.status === 'accepted'
        ? {
            text: 'Thank you — added to the catalogue and attributed to you.',
            href: result.plugin.replace(NAMESPACES.pu, '/'),
            linkText: 'See it'
          }
        : {
            text: 'Thank you — queued for review. It joins the catalogue once a moderator accepts it.',
            href: '/contributions',
            linkText: 'Your contributions'
          }
    })
  } catch (error) {
    if (!(error instanceof SubmissionError)) throw error
    render({
      error: error.message,
      // A duplicate is the one refusal worth linking: the person came to add a
      // plugin and it is already here.
      submitted: error.existing
        ? {
            text: 'It is already in the catalogue:',
            href: error.existing.replace(NAMESPACES.pu, '/'),
            linkText: 'see the entry'
          }
        : null,
      values,
      status: 400
    })
  }
  return true
}

/**
 * Writing to the moderators.
 *
 * The only route here that does not write catalogue data — a message is
 * correspondence, and `src/contrib/Feedback.js` says at length why that matters
 * for where it is stored. It lives in this module anyway because the guards are
 * identical: signed in, not suspended, a CSRF token bound to that account, and
 * a rate limit counted in the store.
 */
async function feedbackRoute ({
  request, response, viewer, auth, search, feedback
}) {
  if (!feedback) {
    send(response, 404, { error: 'Feedback is not enabled on this instance' })
    return true
  }
  if (!viewer.account) {
    needsSignIn(request, response, {
      returnTo: FEEDBACK_PATH,
      message: 'Sign in to send a message to the moderators'
    })
    return true
  }
  const account = viewer.account
  const facetValues = await search.facets()
  const render = extra => sendText(response, extra.status ?? 200,
    renderFeedbackPage({
      csrfToken: auth.session.csrfToken(account.iri),
      viewer,
      facetValues,
      corpus: search.documents.size,
      ...extra
    }), HTML)

  if (request.method !== 'POST') {
    render({})
    return true
  }

  let form
  try {
    form = await readForm(request)
  } catch (error) {
    send(response, error.status ?? 400, { error: error.message })
    return true
  }
  if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
    send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
    return true
  }

  const message = String(form.get('message') ?? '')
  try {
    await feedback.submit({ account, message })
    render({ sent: true })
  } catch (error) {
    if (!(error instanceof FeedbackError)) throw error
    // The message comes back with the form. Somebody who has just written three
    // paragraphs and been told they are one over the limit should not have to
    // write them again.
    render({ error: error.message, message, status: 400 })
  }
  return true
}

/**
 * Uploading a picture of a plugin.
 *
 * Trusted contributors and moderators only, and deliberately without a queued
 * state. A correction can wait in a queue because nobody sees it meanwhile; a
 * picture is public the instant it is served and cannot be un-seen, so the
 * useful question is whether this person is trusted — which this site already
 * measures — rather than whether somebody will get round to looking.
 */
async function imageRoute ({
  request, response, viewer, auth, search, images, corrections, navigationFor
}, slug) {
  if (!images || !corrections) return false

  const pluginIri = `${NAMESPACES.pu}plugin/${slug}`
  const doc = search.documents.get(pluginIri)
  if (!doc) {
    send(response, 404, { error: 'No such plugin', iri: pluginIri })
    return true
  }
  if (request.method !== 'POST') {
    redirect(response, `/plugin/${slug}`)
    return true
  }

  const account = viewer.account
  if (!account) {
    needsSignIn(request, response, {
      returnTo: `/plugin/${slug}`,
      message: 'Sign in to add a picture'
    })
    return true
  }
  const mayUpload = account.trustLevel === TRUST.TRUSTED || account.trustLevel === TRUST.MODERATOR
  if (!mayUpload) {
    send(response, 403, {
      error: 'Pictures can be added by trusted contributors. Accepted corrections earn that.'
    })
    return true
  }

  const navigation = await navigationFor()
  const page = (subject, extra) => sendText(response, extra.status ?? 200,
    renderPluginPage(subject, viewer, {
      account,
      csrfToken: auth.session.csrfToken(account.iri),
      correctable: CORRECTABLE,
      mayUploadImage: true,
      ...extra
    }, search.measured(pluginIri), '', navigation), HTML)

  let form
  try {
    form = await readMultipart(request, { maxBytes: IMAGE_CONFIG.maxBytes })
  } catch (error) {
    if (!(error instanceof BodyError)) throw error
    page(doc, { imageError: error.message, status: error.status ?? 400 })
    return true
  }
  if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
    send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
    return true
  }

  const uploaded = form.files?.get('image')
  try {
    const stored = await images.store(uploaded?.buffer ?? Buffer.alloc(0))
    await corrections.submit({
      account,
      subject: pluginIri,
      predicate: `${NAMESPACES.foaf}depiction`,
      value: stored.url,
      rationale: `Uploaded ${stored.type}, ${stored.bytes} bytes.`
    })
    // The document in memory has to learn about it too, or the page this
    // renders still shows the old picture — or none.
    await search.takeUpNewPlugins()
    page(search.documents.get(pluginIri) ?? doc, { imageDone: 'Added, and attributed to you.' })
  } catch (error) {
    if (error instanceof ImageError || error instanceof CorrectionError) {
      page(doc, { imageError: error.message, status: 400 })
      return true
    }
    throw error
  }
  return true
}

/**
 * Suggesting a correction to a fact about a plugin.
 */
async function correctionRoute ({
  request, response, viewer, auth, search, corrections, navigationFor
}, slug) {
  if (!auth || !corrections) {
    send(response, 404, { error: 'Contributions are not enabled' })
    return true
  }
  const pluginIri = `${NAMESPACES.pu}plugin/${slug}`
  const doc = search.documents.get(pluginIri)
  if (!doc) {
    send(response, 404, { error: 'No such plugin' })
    return true
  }

  const account = viewer.account
  if (!account) {
    send(response, 401, { error: 'Sign in to suggest a correction' })
    return true
  }

  let form
  try {
    form = await readForm(request)
  } catch (error) {
    send(response, error.status ?? 400, { error: error.message })
    return true
  }

  if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
    // Stale token, or a post that did not come from a page we served.
    send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
    return true
  }

  // Read once, not per render: the helper below is called on both the success
  // and the failure path.
  const navigation = await navigationFor()
  const render = extra => sendText(response, extra.status ?? 200,
    renderPluginPage(doc, viewer, {
      account,
      csrfToken: auth.session.csrfToken(account.iri),
      correctable: CORRECTABLE,
      ...extra
    }, search.measured(pluginIri), '', navigation), HTML)

  try {
    const result = await corrections.submit({
      account,
      subject: pluginIri,
      predicate: form.get('predicate'),
      value: form.get('value'),
      rationale: form.get('rationale'),
      currentValue: doc[CORRECTABLE[form.get('predicate')]?.docField] ?? null
    })
    render({
      submitted: result.status === 'accepted'
        ? 'Thank you — applied, and attributed to you.'
        : 'Thank you — queued for review.'
    })
  } catch (error) {
    if (error instanceof CorrectionError) {
      render({ error: error.message, status: 400 })
      return true
    }
    throw error
  }
  return true
}

export default contributionRoutes
