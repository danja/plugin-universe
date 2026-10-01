#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import SearchService from '../src/search/SearchService.js'
import { createServer } from '../src/api/server.js'
import Accounts from '../src/auth/Accounts.js'
import AuthRoutes from '../src/auth/routes.js'
import Corrections from '../src/contrib/Corrections.js'
import Feedback from '../src/contrib/Feedback.js'
import BundleReader from '../src/contrib/BundleReader.js'
import Promotions from '../src/catalogue/Promotions.js'
import Billing from '../src/billing/Billing.js'
import Submissions, { loadSubmittable } from '../src/contrib/Submissions.js'
import ImageStore from '../src/api/ImageStore.js'
import ShapeValidator from '../src/store/ShapeValidator.js'
import Wiki from '../src/wiki/Wiki.js'

logger.setLevel('info')

const config = Config.load()
const port = Number(process.env.PORT) || 4100

const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})
const embeddings = EmbeddingService.fromConfig(config)
// Declared before the search service, which uses it to tell a picture this site
// hosts from one it merely links to.
//
// `||`, not `??`. docker-compose passes `${SITE_ORIGIN:-}`, which is an empty
// string when the variable is unset — and `??` only falls back on null or
// undefined, so an unset variable arrived as '' and defeated the default. This
// took the site down with "needs the site origin". An empty environment
// variable means unset everywhere in this project; Config.js already treats it
// that way.
const origin = process.env.SITE_ORIGIN || config.get('site.origin')
const search = new SearchService({ client, index, embeddings, origin })
const loaded = await search.loadDocuments()

// Loaded once at start, not per request: the index is the hot path and it is
// read from disk, not rebuilt from the triple store.
console.log(`Loaded ${loaded} plugins, ${index.size} vectors from ${index.path}`)

// Sign-in, when the instance is configured for it. A read-only deployment is a
// legitimate thing to run and does not need an OAuth App.
const accounts = new Accounts(client)
const { routes: auth, reason: authProblem } = AuthRoutes.fromEnvironment({ accounts, origin })
// The choices the submission form offers, read from the vocabularies once
// rather than copied into JavaScript: roles and signal types from
// vocabs/trn-profile.ttl, categories from vocabs/categories.ttl. A failure here
// is fatal on purpose — a form offering nothing to choose from looks like it
// should work.
const submittable = await loadSubmittable()
console.log(`Vocabularies loaded: ${submittable.role.choices.length} roles, ` +
  `${submittable.accepts.choices.length} signal types, ` +
  `${submittable.category.choices.length} categories`)

let corrections = null
let feedback = null
let promotions = null
let billing = null
let submissions = null
let wiki = null

// Built unconditionally, and this moved out of the sign-in block for a reason.
// Images used to arrive only as uploads, so an instance without OAuth had no
// pictures and no reason to serve any. That stopped being true when
// bin/harvest-jigdaw.js began writing panel screenshots into the same store:
// depictions harvested from a source are in the graph whether or not anybody
// can sign in, so a read-only deployment holding them answered /image/<hash>
// with "Images are not enabled on this instance" — 25 broken pictures on the
// plugin pages, and the count of stored images printed nowhere so nobody could
// see they were there. Serving what is in the store is not a privileged act.
const images = new ImageStore({ origin })
console.log(`Image store ready, ${(await images.list()).length} stored`)

if (auth) {
  // Registered at startup, not at first sign-in: a graph holding personal data
  // that is not flagged as such is the one failure this design exists to
  // prevent, and it must not wait on somebody signing in.
  await accounts.ensureGraph()
  // Corrections needs the image store: a contributed picture is a correction
  // naming foaf:depiction, and the store is what says whether a value is an
  // image this site actually holds. Built above, outside this block.
  corrections = new Corrections(client, { images })
  await corrections.ensureGraph()
  promotions = new Promotions(client)
  await promotions.ensureGraph()
  search.promotions = promotions
  console.log(`Promotion enabled, ${await search.loadPromotions()} live placement(s)`)
  const payments = Billing.fromEnvironment({ origin })
  billing = payments.billing
  if (billing) {
    const state = billing.status()
    console.log(`Payments enabled in ${state.mode} mode, webhook ${state.webhook}`)
  } else if (payments.reason) {
    // Half-configured is not the same as deliberately absent, and the
    // difference has to be visible or a broken payment system reads as a
    // read-only deployment.
    console.log(`Payments DISABLED — ${payments.reason}`)
  } else {
    console.log('Payments disabled — no Stripe keys set')
  }
  // The same SHACL shapes a harvest is checked against. A plugin somebody
  // typed is not a different kind of plugin, and the shapes are the only thing
  // that knows a format IRI from a typo.
  submissions = new Submissions(client, { validator: await ShapeValidator.load(), submittable })
  await submissions.ensureGraph()
  console.log('Image uploads enabled')
  console.log(`Sign-in enabled, callback ${origin}/auth/callback`)
  wiki = new Wiki(client)
  // Messages to the moderators. Registered eagerly so the graph and its
  // personal-data flag exist before the first message rather than being created
  // by it — a graph registered under load is a graph whose licence flag was
  // decided under load.
  feedback = new Feedback(client)
  await feedback.ensureGraph()
  console.log(`Feedback enabled, ${(await feedback.pending()).length} unread`)
  console.log('Contributions enabled')
  console.log('Wiki enabled')
} else if (authProblem) {
  console.log(`Sign-in DISABLED — ${authProblem}`)
} else {
  console.log('Sign-in disabled (no GITHUB_CLIENT_ID/SECRET); the site is read-only')
}

// The published dataset, for the MCP SPARQL tool. Optional: without it the
// tool is simply not offered, rather than being offered and failing. A SPARQL
// tool over the live store would be a way to ask for accounts by name.
let publication = null
try {
  const candidate = new SPARQLClient(config.get('storage.publication'))
  publication = await candidate.isReachable() ? candidate : null
  console.log(publication
    ? 'MCP enabled, including SPARQL over the published dataset'
    : 'MCP enabled without SPARQL: the published dataset is not reachable')
} catch (error) {
  console.log(`MCP enabled without SPARQL: ${error.message}`)
}

const server = createServer({
  submittable,
  search, config, projectRoot: Config.projectRoot, auth, corrections, submissions, images, promotions, billing,
  feedback,
  // Reading an LV2 bundle's Turtle at a moderator's request. Needs no
  // configuration: the fetch defences are PageReader's and come with it.
  bundleReader: new BundleReader(),
  wiki, publication, authProblem
})
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
  console.log('  GET /health           service status')
  console.log('  GET /search?q=...     hybrid search, with optional format/role/category/vendor')
  console.log('  GET /facets           facet values and counts')
  console.log('  GET /plugins          browse')
  console.log('  GET /plugin/<slug>    one plugin')
  console.log('  GET /category/<slug>  one category, and what is in it')
  console.log('  GET /ns/<name>.ttl    the vocabularies the data refers to')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
