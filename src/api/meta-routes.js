import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import { send, sendText, LICENCE, HTML } from './respond.js'
import { renderVocabularies } from './render.js'
import buildRegistry from './registry.js'
import { ImageError } from './ImageStore.js'

/**
 * What the site says about itself, and the files it serves flat.
 *
 * Five routes with nothing in common except that none of them is a page about
 * a plugin: the health check a monitor polls, `robots.txt`, the Open Audio
 * Stack registry view, the vocabulary documents that every published IRI
 * resolves to, and the stored images.
 *
 * They were scattered through `server.js`'s switch and its default branch.
 * Grouping them is what makes the file that is left recognisably *the
 * catalogue's* routes.
 */

const PATHS = new Set([
  '/health', '/robots.txt', '/favicon.png', '/favicon.ico', '/og-image.png', '/site.js',
  '/registry/plugins/index.json', '/ns'
])
const VOCAB_PATH = /^\/ns\/([a-z0-9-]+)\.ttl$/
const IMAGE_PATH = /^\/image\/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$/

export async function metaRoutes (context) {
  const { path } = context

  if (path === '/health') return health(context)
  // Anything on the static whitelist, rather than one `if` per file. The
  // whitelist and the router were two lists for exactly as long as there was
  // one file on it, and the second file arrived declared but unserved.
  if (context.staticFiles?.[path]) return staticFile(context)
  if (path === '/registry/plugins/index.json') return registry(context)
  if (path === '/ns') return vocabularyIndex(context)

  const vocab = path.match(VOCAB_PATH)
  if (vocab) return vocabularyDocument(context, vocab[1])

  const picture = path.match(IMAGE_PATH)
  if (picture) return storedImage(context, picture[1])

  return false
}

/** Whether a path belongs to this module, without doing the work. */
export function isMetaPath (path) {
  return PATHS.has(path) || VOCAB_PATH.test(path) || IMAGE_PATH.test(path)
}

/**
 * What is wrong with this instance, in words.
 *
 * Pure, and exported, because the interesting case is the one a healthy
 * instance cannot demonstrate: a check that only ever runs against a correct
 * store is a check nobody has seen fire.
 *
 * `/health` reported `plugins` and `index` side by side and asserted nothing
 * about them — two numbers and no claim that they agree, which is the shape of
 * defect this project has written down more than once. A plugin can reach the
 * catalogue and not the vector index, because `takeUpNewPlugins` allows that
 * deliberately: refusing a whole submission over a failed embedding would be
 * worse than accepting a plugin that is findable by name today and by meaning
 * tomorrow. The cost is that the failure is reported nowhere but a log line.
 *
 * @param {string[]} unindexed - plugin IRIs the vector index does not hold
 * @param {{total: number, minted: number}|null} vendors - identity coverage
 * @param {string|null} authProblem
 */
export function healthProblems ({ unindexed = [], vendors = null, authProblem = null } = {}) {
  const problems = []
  if (unindexed.length > 0) {
    problems.push({
      what: 'unindexed',
      detail: `${unindexed.length} plugin(s) are in the catalogue and not in the vector ` +
        'index, so they are findable by name and invisible to semantic search. ' +
        'Run: node bin/ingest.js --only-new',
      // A sample rather than all of them: this is a health check, not a report,
      // and a monitor that has to parse eight hundred IRIs is one that times out.
      plugins: unindexed.slice(0, 10).map(iri => iri.replace(/^.*\/plugin\//, ''))
    })
  }
  // The whole identity layer missing, as distinct from being behind.
  //
  // This is the check that would have caught what actually happened:
  // `bin/mint-vendors.js` had never been run on the serving host, so there were
  // no `pu:Vendor` resources at all — and nothing reported it, because every
  // vendor page is folded from `trn:vendor` strings and answers 200 without the
  // graph. Only the total absence is a problem: some vendors being unminted is
  // the ordinary state between an accepted submission and the next derivation,
  // and flagging that would make this noise.
  if (vendors && vendors.total > 0 && vendors.minted === 0) {
    problems.push({
      what: 'vendor-identity',
      detail: `${vendors.total} vendor(s) and no minted identity for any of them, so ` +
        'nothing can be claimed, described or merged, and the published dataset ' +
        'names makers only as strings. ' +
        'Run: node bin/mint-vendors.js, then restart, then node bin/publish.js'
    })
  }
  if (authProblem) problems.push({ what: 'sign-in', detail: authProblem })
  return problems
}

/**
 * `ok` means serving *and* consistent.
 *
 * Anything in `problems` makes it `degraded`: the site answers, and something
 * about it is wrong in a way somebody has to fix. Never `error` — a process
 * that could not serve would not be answering this at all.
 */
export function healthStatus (problems) {
  return problems.length === 0 ? 'ok' : 'degraded'
}

function health ({ response, search, config, auth, authProblem, build }) {
  const unindexed = search.unindexed()
  const vendors = search.vendorIdentityCoverage()
  const problems = healthProblems({ unindexed, vendors, authProblem })

  send(response, 200, {
    // `ok` means serving and consistent. Anything in `problems` makes it
    // `degraded`: the site answers, and something about it is wrong in a way
    // somebody has to fix. It is never `error` — a process that could not serve
    // would not be answering this.
    status: healthStatus(problems),
    problems,
    plugins: search.documents.size,
    index: search.index.size,
    unindexed: unindexed.length,
    // How many plugins carry a profiler reading, and when the newest run was.
    // Here because measurements are made on one machine and carried to
    // another, and until this existed there was no way to ask the deployment
    // whether a delivery had landed — the first one did not, and the symptom
    // was an absent facet, which looks exactly like a feature nobody built.
    measured: search.measurements.size,
    measuredAt: [...search.measurements.values()]
      .map(entry => entry.at).sort().pop() ?? null,
    // Vendors, and how many carry a minted identity. Reported as a count rather
    // than only as a problem, because "some are unminted" is the ordinary state
    // and is still worth being able to watch: it is what says whether a
    // derivation is overdue, before it becomes the kind of absence nobody sees.
    vendors: vendors.total,
    vendorsMinted: vendors.minted,
    embeddingModel: config?.get('embedding.model') ?? null,
    // Which code, not just which data. Null means the image was built without
    // a stamp, not that the build is old.
    build,
    // So a half-configured sign-in is visible to monitoring rather than only to
    // whoever reads the container log at startup.
    signIn: auth ? 'enabled' : (authProblem ? 'misconfigured' : 'disabled'),
    ...(authProblem ? { signInProblem: authProblem } : {}),
    licence: LICENCE
  })
  return true
}

async function staticFile ({ response, path, projectRoot, staticFiles }) {
  const served = staticFiles[path]
  // Read as bytes, not as text. This said `'utf8'` while the only static file
  // was robots.txt, and the first binary one — a favicon — would have been
  // mangled into replacement characters by the decode, served with the right
  // content type, and shown as a broken icon with nothing in any log.
  const body = await fs.promises.readFile(pathJoin(projectRoot, served.file))
  response.writeHead(200, {
    'Content-Type': served.type,
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    ...(served.cache ? { 'Cache-Control': served.cache } : {}),
    'Access-Control-Allow-Origin': '*'
  })
  response.end(body)
  return true
}

/**
 * The catalogue as an Open Audio Stack registry, so the tooling that already
 * reads that format can consume this one. Federation over competition, from
 * docs/suggestions.md.
 */
async function registry ({ response, search }) {
  const rows = await search.client.select(search.queries.get('plugin/registry', {}))
  const { index, withheld } = buildRegistry(rows, search.sources)
  if (withheld.length > 0) {
    logger.info(`[registry] ${withheld.length} plugin(s) withheld: not redistributable`)
  }
  send(response, 200, index)
  return true
}

/**
 * Negotiated, like a plugin IRI. It is linked from the footer of every page,
 * and a JSON blob is not an answer to a person who followed a link called
 * "Vocabularies".
 */
function vocabularyIndex ({ request, response, viewer, vocabularies, negotiate }) {
  if (negotiate('', request.headers.accept) !== 'html') {
    send(response, 200, {
      vocabularies: Object.entries(vocabularies).map(([name, vocabulary]) => ({
        name, url: `/ns/${name}.ttl`, description: vocabulary.description
      })),
      licence: LICENCE
    })
    return true
  }
  sendText(response, 200, renderVocabularies(vocabularies, viewer), HTML)
  return true
}

/**
 * The vocabulary documents. These are what the `pu:` IRIs in every published
 * description resolve to.
 */
async function vocabularyDocument ({ response, projectRoot, vocabularies }, name) {
  const file = vocabularies[name]?.file
  if (!file) {
    send(response, 404, { error: 'No such vocabulary', name })
    return true
  }
  const body = await fs.promises.readFile(
    isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
  sendText(response, 200, body, 'text/turtle; charset=utf-8')
  return true
}

/**
 * An uploaded image, served from this origin so that nobody's browser has to
 * fetch a picture from a third party to read a plugin page.
 *
 * The type is sniffed from the bytes on every read rather than taken from the
 * extension, and `nosniff` stops a browser second-guessing it — between them
 * there is no way for a file on disk to be served as anything but what it
 * actually is. Immutable, because the name is the hash of the content: a
 * different picture is a different URL, so this can never be stale.
 */
async function storedImage ({ response, images }, name) {
  if (!images) {
    send(response, 404, { error: 'Images are not enabled on this instance' })
    return true
  }
  let held
  try {
    held = await images.read(name)
  } catch (error) {
    if (error instanceof ImageError) {
      send(response, 404, { error: error.message })
      return true
    }
    if (error.code === 'ENOENT') {
      send(response, 404, { error: 'No such image' })
      return true
    }
    throw error
  }
  response.writeHead(200, {
    'Content-Type': held.type,
    'Content-Length': held.buffer.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*'
  })
  response.end(held.buffer)
  return true
}

export default metaRoutes
