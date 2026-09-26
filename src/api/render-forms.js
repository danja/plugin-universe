import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG, IMAGE_CONFIG, PROMOTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import templates from './Templates.js'
import { layout, sidebar } from './page-shell.js'

/**
 * The pages a person fills in, and the console above them.
 *
 * Submitting a plugin, suggesting a correction, adding a picture, the account
 * page, a contributor's own list, and the moderator's queue. They change when
 * a *workflow* changes — a new field, a new privilege, a new decision — where
 * the catalogue pages change when the data does. Two reasons to change, two
 * files, which is the same cut that took the serialisations out of `render.js`
 * when it first grew too large.
 */

/**
 * One plugin, with the same two columns the search pages carry.
 *
 * The navigation is a sixth argument rather than a fifth positional one
 * because five was already too many; it is the only thing here that is about
 * the site rather than about the plugin.
 */
/**
 * The upload form, for somebody allowed to use it.
 *
 * Only shown to a trusted contributor or a moderator. An uploaded picture is
 * public the moment it is served and cannot be un-seen, so unlike a correction
 * or a submission there is no useful "queued" state — the choice is to trust
 * the uploader or not, and trust is something this site already measures.
 */
export function imageForm (slug, { csrfToken, error = null, done = null } = {}) {
  return templates.render('image-form', {
    slug,
    csrf: csrfToken ?? '',
    maxKb: String(Math.round(IMAGE_CONFIG.maxBytes / 1024)),
    error: templates.when(Boolean(error), 'error', { text: error }),
    done: templates.when(Boolean(done), 'notice', { text: done })
  })
}

/**
 * The moderation queue.
 *
 * Deliberately plain: a moderator wants to see what was proposed, by whom, and
 * why, and then decide. Each decision is its own form with its own token, so a
 * stale page cannot accept something the moderator has not looked at.
 */
/**
 * What one person has proposed, and what became of it.
 *
 * Their own contributions only, and only to them. A pending correction sits in
 * the personal-data graph with the contributor's own words about why they think
 * something is wrong — theirs to see, not a public record. The part that
 * becomes public on acceptance is the fact itself, attributed to them on the
 * plugin page.
 *
 * Without this page a contributor suggests something and it vanishes: no
 * acknowledgement, no queue position, no way to know a moderator declined it.
 * That is the state the correction form shipped in.
 */
/**
 * The form for proposing a plugin the catalogue does not have.
 *
 * Built from `SUBMITTABLE` rather than written out, so the form, the validator
 * and the triples it becomes cannot drift apart — the help text beside each
 * input is the same string the error message quotes when the field is missing.
 *
 * Whatever was typed comes back on an error. A form that empties itself when it
 * refuses is a form people fill in once.
 */
/**
 * Where each drafted field came from, as a list.
 *
 * One function rather than three copies, because a draft now arrives by three
 * routes — a page a moderator fetched, a profile somebody pasted, and a JigDAW
 * address anybody fetched — and the only thing that differs between them is
 * the sentence above the list.
 */
function draftSources (draft, submittable) {
  if (!draft || !Object.keys(draft.sources ?? {}).length) return ''
  return `<ul class="draft-sources">${templates.each('submit-draft-source',
    Object.entries(draft.sources), ([key, from]) => ({
      label: submittable[key]?.label ?? key, from
    }))}</ul>`
}

/** What the draft could not work out, or read and did not keep. */
function draftNotes (draft) {
  if (!draft?.notes?.length) return ''
  return `<ul class="draft-notes">${templates.each('submit-draft-note',
    draft.notes, text => ({ text }))}</ul>`
}

/**
 * What a fetched JigDAW collection holds, as a list of members.
 *
 * Each member arrives from the route already judged — new, already in the
 * catalogue, already proposed, or unreadable — so this only renders. A new one
 * carries its own small form posting back to `/submit`, which re-fetches that
 * single address into the draft above; the others link to where they already
 * are rather than offering a button that would go nowhere.
 */
function jigCollectionPanel (result, csrfToken) {
  if (!result) return ''
  const rows = (result.members ?? []).map(member => {
    if (member.state === 'new') {
      return templates.render('submit-jig-member-new', {
        csrf: csrfToken ?? '',
        url: member.url,
        name: member.name,
        detail: 'Not in the catalogue yet.'
      })
    }
    if (member.state === 'catalogued') {
      return templates.render('submit-jig-member-known', {
        name: member.name,
        detail: 'Already in the catalogue.',
        href: member.href,
        linkText: 'See it'
      })
    }
    if (member.state === 'pending') {
      return templates.render('submit-jig-member-known', {
        name: member.name,
        detail: 'Already proposed and waiting for review.',
        href: '/contributions',
        linkText: 'Contributions'
      })
    }
    return templates.render('submit-jig-member-known', {
      name: member.name ?? member.url,
      detail: member.error ?? 'Could not be read.',
      href: member.url,
      linkText: 'the address'
    })
  }).join('')
  return templates.render('submit-jig-collection', {
    label: result.collection?.label ?? 'Untitled collection',
    url: result.collection?.url ?? '',
    comment: result.collection?.comment
      ? templates.render('tags-line', { text: result.collection.comment })
      : '',
    members: rows
  })
}

/**
 * The page for a profile somebody has already written.
 *
 * Its own address because it is a different act from filling in a form: the
 * work is done, and putting twelve fields in front of that person first asks
 * them to do it twice. It is also the thing to link an author to.
 *
 * The form posts to `/submit`, which drafts it and renders the filled-in form.
 * Nothing about writing lives here.
 */
export function renderProfilePastePage ({
  csrfToken, error = null, profile = '', viewer = {}, facetValues = {}, corpus = 0
}) {
  const body = templates.render('submit-profile-page', {
    heading: templates.render('page-heading', { title: 'Submit a profile' }),
    error: templates.when(Boolean(error), 'error', { text: error }),
    csrf: csrfToken ?? '',
    value: profile,
    maxLength: String(CONTRIBUTION_CONFIG.maxProfileLength),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Submit a profile — Plugin Universe', body, {
    description: 'Submit a plugin profile you already have, in Turtle or JSON-LD.',
    canonical: '/submit/profile',
    ...viewer,
    footer: false
  })
}

export function renderSubmitPage (submittable, {
  csrfToken, error = null, submitted = null, values = {}, viewer = {},
  facetValues = {}, corpus = 0, mayRead = false, mayUpload = false,
  draft = null, pageUrl = '', mayFetchJig = false, jigUrl = '', jigResult = null
}) {
  /** One field: a row of checkboxes where it takes several values, a box where it does not. */
  const field = ([name, spec]) => {
    if (spec.multiple) {
      // A required group with nothing to tick is a form nobody can complete,
      // and it looks like it should work — so it is an error here rather than
      // an empty row on the page.
      if (!spec.choices?.length) {
        throw new Error(`${name} takes several values but declares no choices to offer.`)
      }
      const chosen = new Set([values[name] ?? []].flat())
      // The label a reader sees, from `rdfs:label` in the vocabulary, the same
      // lookup the select below uses and the same one the plugin page renders
      // these terms with. It showed the bare local name until now, so a form
      // offering "ControlMidi" and "MacOS" led to a page saying "Control MIDI"
      // and "macOS" — one fact, two spellings, and the form had the worse one.
      const label = new Map((spec.terms ?? spec.labels ?? []).map(term => [term.value, term.label]))
      return templates.render('submit-checkboxes', {
        label: spec.label,
        help: spec.help,
        boxes: templates.each('submit-checkbox', spec.choices, value => ({
          name,
          value,
          text: label.get(value) ?? value,
          checked: chosen.has(value) ? ' checked' : ''
        }))
      })
    }
    // A picture: an upload, not a URL box.
    //
    // Drawn only for somebody allowed to upload, which is a trusted contributor
    // or a moderator — the same rule the plugin page's own upload applies, for
    // the same reason. A picture is public the moment it is served and cannot
    // be un-seen, so there is no useful queued state: the choice is to trust
    // the uploader or not, and this site already measures that.
    //
    // When the field is not drawn it is simply absent, and a submission without
    // one is complete. That is why it is optional.
    if (spec.upload) {
      if (!mayUpload) return ''
      return templates.render('submit-image', {
        label: spec.label,
        help: spec.help,
        required: spec.required ? '' : ' (optional)',
        maxKb: String(Math.round(IMAGE_CONFIG.maxBytes / 1024)),
        // What is already attached, carried in a hidden field so that an error
        // elsewhere on the form does not throw the picture away and ask for it
        // again — the same reason every other value is handed back.
        attached: templates.when(Boolean(values[name]), 'submit-image-attached', {
          url: values[name] ?? ''
        })
      })
    }
    // One value chosen from a closed list: a select, not a text box.
    //
    // Category was typed until 2026-09-14, checked only against
    // `^[a-z0-9-]+$`, so "revrb" was accepted and minted a concept the scheme
    // does not define — reported as undescribed by a store test long after the
    // person who could have fixed it had gone. A list the vocabulary supplies
    // cannot be misspelled, and it also *shows* somebody what the catalogue
    // has, which a free-text box never did.
    if (spec.choices) {
      if (!spec.choices.length) {
        throw new Error(`${name} is chosen from a list and declares no choices to offer.`)
      }
      const label = new Map((spec.labels ?? []).map(term => [term.value, term.label]))
      return templates.render('submit-select', {
        name,
        label: spec.label,
        help: spec.help,
        // An optional field needs a way to choose nothing, and it has to be the
        // default — otherwise the first option silently becomes the answer for
        // everybody who does not look.
        //
        // Named from the field rather than written out: this said "No category"
        // for every select, so the licence dropdown offered "No category" as
        // its blank option. Nothing would have caught that — it is page text,
        // and the test suite is not a proofreader.
        blank: spec.required ? 'Choose one' : `No ${spec.label.toLowerCase()}`,
        required: spec.required ? '' : ' (optional)',
        requiredAttr: spec.required ? ' required' : '',
        options: templates.each('submit-option', spec.choices, value => ({
          value,
          label: label.get(value) ?? value,
          selected: values[name] === value ? ' selected' : ''
        }))
      })
    }
    return templates.render('submit-field', {
      name,
      label: spec.label,
      help: spec.help,
      // A URL field gets the keyboard and the validation a browser already has.
      type: spec.kind === 'url' ? 'url' : 'text',
      value: values[name] ?? '',
      maxLength: String(CONTRIBUTION_CONFIG.maxValueLength),
      required: spec.required ? '' : ' (optional)',
      requiredAttr: spec.required ? ' required' : ''
    })
  }

  const body = templates.render('submit', {
    heading: templates.render('page-heading', { title: 'Submit a plugin' }),
    csrf: csrfToken ?? '',
    error: templates.when(Boolean(error), 'error', { text: error }),
    done: templates.when(Boolean(submitted), 'submit-done', {
      text: submitted?.text ?? '',
      href: submitted?.href ?? '/',
      linkText: submitted?.linkText ?? ''
    }),
    fields: Object.entries(submittable).map(field).join('\n  '),
    // Moderators only. `docs/sources.md` §4 rule 8: an open form is an open
    // proxy, and "a person asked for it" stops being true the moment anyone
    // can ask. The route checks it too — this only decides whether to draw it.
    fetch: templates.when(Boolean(mayRead), 'submit-fetch', {
      csrf: csrfToken ?? '',
      value: pageUrl,
      maxLength: String(CONTRIBUTION_CONFIG.maxValueLength)
    }),
    // Anybody signed in. Unlike the box above this one reads no prose: a
    // plugin's own address serves its profile and a collection names its
    // members, so there is no judgement to exercise — only a moderator could
    // weigh what a page says about itself, but a profile says it for machines.
    jigFetch: templates.when(Boolean(mayFetchJig), 'submit-jig-fetch', {
      csrf: csrfToken ?? '',
      value: jigUrl,
      maxLength: String(CONTRIBUTION_CONFIG.maxValueLength)
    }),
    // Where each drafted field came from, shown rather than summarised: a page
    // that named itself in JSON-LD and one that had a <title> and nothing else
    // do not deserve the same trust, and only the moderator can weigh that.
    // Two draft notes, because they say different things: one names the page it
    // fetched, the other the format it recognised. A single template would have
    // to render an empty link for the pasted case.
    draft: templates.when(Boolean(draft) && !draft?.url, 'submit-draft-pasted', {
      format: draft?.format ?? '',
      sources: draftSources(draft, submittable),
      notes: draftNotes(draft)
    }) + templates.when(Boolean(draft?.url), 'submit-draft', {
      url: draft?.url ?? '',
      sources: draftSources(draft, submittable),
      notes: draftNotes(draft)
    }),
    // What a fetched collection holds: one row per member, each either drafted
    // at a press or already accounted for. Built here rather than in the route
    // so the route decides the state and this decides the markup.
    jigCollection: jigCollectionPanel(jigResult, csrfToken),
    // The same two columns the search pages carry. Somebody who has just
    // submitted a plugin, or been told theirs is already here, wants a way
    // back into the catalogue rather than a dead end.
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Submit a plugin — Plugin Universe', body, {
    description: 'Propose a plugin for the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

/**
 * A person's own account: what they are on, and how to change it.
 *
 * Three states and one of them is easy to forget — **lapsed**. Somebody whose
 * subscription ended needs to be told so plainly, because the alternative is a
 * page that looks like the free plan and leaves them wondering what happened to
 * the placements they were paying for.
 *
 * Prices are passed in rather than written here. They live in Stripe, and a
 * figure typed into a template is a second place for a price to be wrong — the
 * failure this whole integration is arranged to avoid.
 */
export function renderAccountPage ({
  account, csrfToken, plan, prices, corpus = 0, notice = null,
  viewer = {}, facetValues = {}
}) {
  const day = value => String(value ?? '').slice(0, 10)
  const proLabel = prices.pro?.label ?? 'Pro'

  const planBlock = () => {
    if (plan.state === 'paid') {
      return templates.render('account-plan-paid', {
        proLabel,
        remaining: plan.daysRemaining === 1 ? '1 day left' : `${plan.daysRemaining} days left`,
        renews: plan.cancelling ? 'ends' : 'renews',
        until: day(plan.endsAt),
        csrf: csrfToken
      })
    }
    if (plan.state === 'lapsed') {
      return templates.render('account-plan-lapsed', { proLabel, until: day(plan.endsAt), csrf: csrfToken })
    }
    return templates.render('account-plan-free', {
      singlePrice: prices.single?.text ?? '—',
      proPrice: prices.pro?.text ?? '—',
      proLabel,
      csrf: csrfToken
    })
  }

  const body = templates.render('account', {
    heading: templates.render('page-heading', { title: 'Your account' }),
    login: account.login,
    standing: account.trustLevel === TRUST.MODERATOR
      ? 'You are a moderator.'
      : account.trustLevel === TRUST.TRUSTED
        ? 'Your contributions go live without review.'
        : 'Your contributions are reviewed before they go live.',
    notice: templates.when(Boolean(notice), 'notice', { text: notice }),
    plan: planBlock(),
    corpus: String(corpus),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Your account — Plugin Universe', body, {
    description: 'Your plan and your standing in the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

export function renderContributionsPage (rows, { viewer = {}, correctable = {}, trustLevel = null }) {
  const BADGE = { accepted: 'src', rejected: 'warn', pending: 'price' }
  const accepted = rows.filter(row => row.status === 'accepted').length

  const body = templates.render('contributions', {
    heading: templates.render('page-heading', { title: 'Your contributions' }),
    standing: rows.length === 0
      ? ''
      : templates.render('meta-line', {
        text: trustLevel === 'new'
          ? `${accepted} of your suggestions have been accepted. ` +
            `After ${CONTRIBUTION_CONFIG.acceptedBeforeTrusted}, later ones go live as soon as you make them.`
          : 'Your corrections are applied as soon as you make them.'
      }),
    items: rows.length === 0
      ? templates.render('empty', { text: 'Nothing yet. Every plugin page has a \u201Csuggest a correction\u201D form.' })
      : templates.each('contribution', rows, row => ({
        slug: row.subject.split('/').pop(),
        badge: templates.render('badge', { kind: BADGE[row.status] ?? 'price', label: row.status }),
        field: correctable[row.predicate]?.label ?? row.predicate.replace(/^.*[/#]/, ''),
        value: row.value,
        rationale: templates.when(Boolean(row.rationale), 'tags-line', { text: row.rationale }),
        at: String(row.at).slice(0, 10),
        decided: row.reviewedAt ? `, decided ${String(row.reviewedAt).slice(0, 10)}` : ''
      }))
  })

  return layout('Your contributions — Plugin Universe', body, {
    description: 'Corrections you have suggested to the Plugin Universe catalogue.',
    ...viewer
  })
}

/**
 * The administration page: the moderation queue, and the buttons.
 *
 * One page rather than two because they are one job — somebody who has just
 * accepted a submission is exactly the person who then wants to reindex, and
 * making them navigate between the queue and a separate console would be an
 * invented boundary.
 */
/**
 * The feedback form.
 *
 * Signed-in only, so the page never has to ask who somebody is — and says so,
 * because the useful thing to tell a person writing in is that the moderators
 * cannot reply here.
 */
export function renderFeedbackPage ({
  csrfToken, viewer = {}, facetValues = {}, corpus = 0,
  message = '', error = null, sent = false, maxLength = CONTRIBUTION_CONFIG.maxFeedbackLength
}) {
  const body = templates.render('feedback', {
    heading: templates.render('page-heading', { title: 'Send feedback' }),
    csrf: csrfToken,
    login: viewer.account?.login ?? '',
    maxLength: String(maxLength),
    // Kept after a refusal, so a long message is not lost to a typo somewhere
    // else on the page. Emptied once it has been sent, so a reload cannot look
    // like an unsent draft.
    message: sent ? '' : message,
    error: templates.when(Boolean(error), 'error', { text: error }),
    done: templates.when(sent, 'notice', {
      text: 'Sent — thank you. A moderator will read it. There is no reply on the site, so if you asked a question, expect an answer by whatever means you gave.'
    }),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Send feedback — Plugin Universe', body, {
    description: 'Send a message to the people who look after the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

export function renderAdminPage (pending, {
  csrfToken, message, viewer = {}, submissions = [], actions = {},
  facetValues = {}, corpus = 0, promotions = null, claims = null, feedback = null,
  bundles = false
}) {
  const total = pending.length + submissions.length
  const body = templates.render('admin', {
    heading: templates.render('page-heading', { title: 'Administration' }),
    login: viewer.account?.login ?? '',
    message: templates.when(Boolean(message), 'notice', { text: message }),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    actions: templates.each('admin-action', Object.entries(actions), ([name, action]) => ({
      name,
      label: action.label,
      describes: action.describes,
      csrf: csrfToken
    })),
    count: total === 0
      ? 'Nothing'
      : [
          pending.length ? `${pending.length} correction${pending.length === 1 ? '' : 's'}` : null,
          submissions.length ? `${submissions.length} proposed plugin${submissions.length === 1 ? '' : 's'}` : null
        ].filter(Boolean).join(' and '),
    items: moderationItems(pending, csrfToken),
    submissions: submissionItems(submissions, csrfToken),
    // Its own panel rather than a third kind of thing in the queue above. A
    // correction and a submission are both decided — accept or reject, with a
    // consequence either way — and a message is only ever read. Mixing them
    // would put a control that applies something next to one that does not.
    feedback: feedback ? feedbackPanel(feedback, csrfToken) : '',
    // Absent when the instance cannot fetch, like every other panel here: a
    // control for something that will always answer "not enabled" is a puzzle.
    bundle: bundles ? templates.render('bundle-panel', { csrf: csrfToken }) : '',
    // Absent entirely when promotions are not configured, rather than an empty
    // panel: a control for something the instance cannot do is a puzzle.
    promotions: promotions ? promotionPanel(promotions, csrfToken) : '',
    // Only where there is a paid tier to entitle. A claim grants nothing on an
    // instance that sells nothing, and a control for that is a puzzle.
    claims: claims
      ? templates.render('claim-panel', {
        csrf: csrfToken,
        summary: claims.count === 0
          ? 'No accounts have a confirmed vendor.'
          : `${claims.count} account${claims.count === 1 ? '' : 's'} with a confirmed vendor.`,
        // Said plainly and only when true. An unresolvable claim entitles
        // nothing and says nothing, so the one place it can surface is here.
        warning: templates.when(Boolean(claims.unresolved), 'claim-warning', {
          count: String(claims.unresolved ?? 0),
          plural: claims.unresolved === 1 ? '' : 's',
          verb: claims.unresolved === 1 ? 'names a vendor' : 'name vendors'
        })
      })
      : ''
  })
  return layout('Administration — Plugin Universe', body, {
    description: 'Moderation queue and catalogue operations.',
    ...viewer,
    footer: false
  })
}

/**
 * What a moderator needs to run paid placements.
 *
 * Three things, and the second is the one that is easy not to think of:
 *
 *  - promote and end, by slug
 *  - **what is about to lapse**, so the conversation about renewing happens
 *    before the placement stops rather than after somebody notices it has
 *  - what is running now, with how long each has left
 *
 * The list of live placements is the ad repository in its working form; the
 * public account of it is /about/promotion.
 */
/**
 * Messages to the moderators.
 *
 * Absent entirely when feedback is not configured, like the promotion and claim
 * panels: a control for something the instance cannot do is a puzzle.
 *
 * The message is inserted through `{{message}}`, which escapes. This is the one
 * place on the site where a stranger's free text reaches an administrator's
 * screen, so it is rendered as text and never as markup — no Markdown, no
 * links, nothing that could be made to look like part of the page around it.
 */
function feedbackPanel (rows, csrfToken) {
  return templates.render('feedback-panel', {
    summary: rows.length === 0
      ? 'Nothing unread.'
      : `${rows.length} unread message${rows.length === 1 ? '' : 's'}.`,
    items: templates.each('feedback-item', rows, row => ({
      iri: row.iri,
      login: row.login ?? row.by,
      message: row.message,
      at: String(row.at).slice(0, 16).replace('T', ' '),
      csrf: csrfToken
    }))
  })
}

function promotionPanel ({ live = [], expiring = [] }, csrfToken) {
  const row = entry => ({
    href: String(entry.plugin).replace(NAMESPACES.pu, '/'),
    name: entry.name ?? String(entry.plugin).split('/').pop(),
    until: String(entry.endsAt).slice(0, 10),
    by: String(entry.by ?? '').split('/').pop(),
    remaining: entry.daysRemaining <= 0
      ? 'lapsed'
      : `${entry.daysRemaining} day${entry.daysRemaining === 1 ? '' : 's'} left`,
    // The soon-to-lapse ones are marked, because a list where every row looks
    // the same is a list nobody scans.
    warnClass: entry.daysRemaining <= PROMOTION_CONFIG.expiringWithinDays ? ' promotion-warn' : ''
  })

  return templates.render('promotion-panel', {
    csrf: csrfToken,
    summary: live.length === 0
      ? 'Nothing is promoted.'
      : `${live.length} live placement${live.length === 1 ? '' : 's'}.`,
    expiring: templates.when(expiring.length > 0, 'promotion-list', {
      title: `Lapsing within ${PROMOTION_CONFIG.expiringWithinDays} days`,
      rows: templates.each('promotion-row', expiring, row)
    }),
    live: templates.when(live.length > 0, 'promotion-list', {
      title: 'Running now',
      rows: templates.each('promotion-row', live, row)
    })
  })
}

/** Corrections, as review cards. */
function moderationItems (pending, csrfToken) {
  if (pending.length === 0) return templates.render('empty', { text: 'Nothing waiting.' })
  return templates.each('moderation-item', pending, item => ({
    field: item.predicate.replace(/^.*[#/]/, ''),
    value: String(item.value).slice(0, 120),
    href: item.subject.replace(NAMESPACES.pu, '/'),
    slug: item.subject.split('/').pop(),
    by: item.by.split('/').pop(),
    rationale: templates.when(Boolean(item.rationale), 'quoted', { text: item.rationale }),
    csrf: csrfToken,
    correction: item.correction
  }))
}

/** Proposed plugins, as review cards. */
function submissionItems (submissions, csrfToken) {
  return templates.each('moderation-submission', submissions, item => ({
    name: item.fields.name ?? '(unnamed)',
    // A proposed plugin has no page to link to yet, so the summary has to
    // carry enough for a decision without one.
    summary: [item.fields.vendor, [item.fields.format].flat().filter(Boolean).join(', '),
      item.fields.category, item.fields.description].filter(Boolean).join(' · ').slice(0, 200),
    by: item.by.split('/').pop(),
    homepage: item.fields.homepage ?? '',
    submission: item.submission,
    csrf: csrfToken
  }))
}

/**
 * The suggest-a-correction form.
 *
 * Only for a signed-in viewer: an anonymous form would need its own spam
 * defence and there would be nobody to attribute the contribution to. Someone
 * signed out gets an invitation instead, carrying a return path so they come
 * back to the plugin they were reading.
 *
 * The field list comes from CORRECTABLE, so the form and the validator cannot
 * disagree about what may be changed.
 */
export function renderCorrectionForm (doc, { account, csrfToken, correctable, error, submitted }) {
  const slug = doc.iri.split('/').pop()
  if (!account) return templates.render('correct-signed-out', { slug })

  return templates.render('correct-form', {
    slug,
    error: templates.when(Boolean(error), 'error', { text: error }),
    submitted: templates.when(Boolean(submitted), 'notice', { text: submitted }),
    csrf: csrfToken,
    // Not every correctable property is one a person types. A picture is
    // contributed by the upload form above, which is the only thing that can
    // produce a value the validator accepts — offering "Picture" here would be
    // a menu entry whose every answer is refused.
    options: templates.each('select-option',
      Object.entries(correctable).filter(([, field]) => field.viaForm !== false),
      ([predicate, field]) => ({ value: predicate, label: field.label })),
    maxValue: CONTRIBUTION_CONFIG.maxValueLength,
    maxRationale: CONTRIBUTION_CONFIG.maxRationaleLength
  })
}

/**
 * Where this profile's facts came from.
 *
 * Shown on every plugin page rather than buried in the graph. The named-graph
 * design exists so that every statement can be traced to a source and a licence
 * (docs/architecture.md §3); a page that does not surface that is asking to be
 * trusted rather than checked. It is also how the sources get credited, which
 * the operating principle requires whether or not their licence compels it.
 */
