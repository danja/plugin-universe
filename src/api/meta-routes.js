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

const PATHS = new Set(['/health', '/robots.txt', '/registry/plugins/index.json', '/ns'])
const VOCAB_PATH = /^\/ns\/([a-z0-9-]+)\.ttl$/
const IMAGE_PATH = /^\/image\/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$/

export async function metaRoutes (context) {
  const { path } = context

  if (path === '/health') return health(context)
  if (path === '/robots.txt') return staticFile(context)
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

function health ({ response, search, config, auth, authProblem, build }) {
  send(response, 200, {
    status: 'ok',
    plugins: search.documents.size,
    index: search.index.size,
    // How many plugins carry a profiler reading, and when the newest run was.
    // Here because measurements are made on one machine and carried to
    // another, and until this existed there was no way to ask the deployment
    // whether a delivery had landed — the first one did not, and the symptom
    // was an absent facet, which looks exactly like a feature nobody built.
    measured: search.measurements.size,
    measuredAt: [...search.measurements.values()]
      .map(entry => entry.at).sort().pop() ?? null,
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
  const body = await fs.promises.readFile(pathJoin(projectRoot, served.file), 'utf8')
  sendText(response, 200, body, served.type)
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
