import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'

/**
 * Screenshots of JigDAW plugins' control panels.
 *
 * A JigDAW plugin has no GUI of its own: its panel is *generated* from its
 * profile by the same code the host draws with, which is why `profile.ttl`
 * carries `lv2:port` rather than anything about layout. So there is no image
 * anywhere in the source repository to harvest — a picture of a plugin's
 * interface has to be taken, and the only honest way to take it is to run the
 * panel generator and photograph the result.
 *
 * **The panel is drawn by jigdaw, not reimplemented here.** `bin/jig.js shot`
 * is the upstream's own screenshot command, so what the catalogue shows is what
 * a host shows. A second implementation of the panel in this repository would
 * be a second thing to keep correct and would drift from the first within a
 * release — the exact failure CLAUDE.md is about, in a component whose whole
 * value is that it is faithful.
 *
 * **Two sources, in order.** jigdaw ships a screenshot per plugin at
 * `web/gallery/shots/<name>.png`, taken by `node bin/build-gallery.js`. Where
 * one exists it is used as-is: it is the upstream's own, it costs nothing, and
 * re-rendering it would only produce a different hash for the same panel. The
 * render path below is the fallback for a plugin upstream ships no picture for,
 * which as of 2026-10-02 is none of the 27: the five that had none
 * (`canticle`, `counterpointer`, `dice`, `keyframe`, `midifilter`) were given
 * one upstream once its own screenshot pipeline was fixed, `parameq` had one
 * from the start, and `stomp-rack`, a composite whose panel is the generated
 * panel of the controls it exposes, has one too.
 *
 * **Chrome is optional, and its absence is reported rather than swallowed.**
 * A missing browser means some plugins have no picture; it never means they
 * are missing from the catalogue. `bin/harvest-jigdaw.js --require-shots` turns
 * that into a failure for a run that is meant to produce pictures.
 */
export class ScreenshotError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ScreenshotError'
  }
}

/**
 * The stylesheet the panel is drawn with, inside the jigdaw checkout.
 *
 * Named once and used once, to check it exists. The failure that guards is a
 * stylesheet that is not there: `bin/jig.js shot` then photographs an unstyled
 * page — labels and bare `<select>`s down the left, every dial invisible — and
 * exits 0 having written a perfectly valid PNG of it, so nothing reports a
 * problem and the only symptom is that the picture is wrong.
 */
const PANEL_STYLESHEET = 'panel.css'

export class JigDawScreenshots {
  /**
   * @param {object} options
   * @param {string} options.repoPath - the jigdaw checkout
   * @param {string} [options.cacheDir] - where rendered panels are kept between
   *   runs. Under data/cache/ so it is neither committed nor an image the
   *   catalogue serves: `ImageStore` holds the one the site links to.
   * @param {string} [options.chrome] - the browser binary. `CHROME_BIN`, or
   *   the path jigdaw's own `shot` defaults to.
   */
  constructor ({ repoPath, cacheDir = 'data/cache/jigdaw/shots', chrome = null }) {
    if (!repoPath) throw new ScreenshotError('JigDawScreenshots needs repoPath')
    this.repoPath = repoPath
    this.cacheDir = path.resolve(cacheDir)
    this.chrome = chrome ?? process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
  }

  /** The screenshot jigdaw already ships for this plugin, or null. */
  shippedPath (name) {
    const file = path.join(this.repoPath, 'web', 'gallery', 'shots', `${name}.png`)
    return fs.existsSync(file) ? file : null
  }

  /** Can this machine render a panel at all? */
  get canRender () {
    return fs.existsSync(this.chrome)
  }

  /**
   * The path to pass to `node` for jigdaw's own screenshot command.
   *
   * Realpath'd, and that is not tidiness. `bin/jig.js` decides it was invoked
   * by comparing `process.argv[1]` with its own resolved `import.meta.url`, so
   * reached through a symlink the two differed, `main()` never ran, and the
   * process exited 0 having written nothing: `/home/danny/github/jigdaw` is the
   * same directory as `/chalet/github/jigdaw` under two names on this machine,
   * and every render silently produced no file. The check below catches that
   * rather than trusting the exit status, because an exit status of 0 with no
   * picture is exactly the failure this method exists to make visible.
   *
   * Upstream now compares resolved paths too (2026-10-02), so the two agree and
   * this is belt and braces rather than the only defence.
   */
  jigCommand () {
    const file = path.join(this.repoPath, 'bin', 'jig.js')
    try {
      return fs.realpathSync(file)
    } catch {
      return file
    }
  }

  /**
   * Render one plugin's panel and photograph it, by running upstream's own
   * screenshot command.
   *
   * The viewport height is derived from the port count the way
   * `bin/build-gallery.js` derives it, rather than left at jigdaw's default:
   * a panel with 40 controls shot at 700px is a cropped fragment, and a cropped
   * screenshot published as *the* picture of a plugin is worse than none.
   *
   * @param {string} name - the plugin directory name under plugins/
   * @param {object} [options]
   * @param {number} [options.ports] - how many ports the panel has. Only a
   *   fallback: the profile read here is authoritative, and a caller passing a
   *   stale count gets the right height anyway.
   */
  async render (name, { ports = 0, width = 1100 } = {}) {
    if (!this.canRender) {
      throw new ScreenshotError(`no Chrome at ${this.chrome}; set CHROME_BIN to render panels`)
    }
    // Before anything is rendered: an unstyled panel is a valid PNG of
    // nothing, so the cheapest honest answer to "the stylesheet is missing" is
    // to refuse rather than to publish a picture that looks like a broken
    // plugin.
    if (!fs.existsSync(path.join(this.repoPath, 'web', PANEL_STYLESHEET))) {
      throw new ScreenshotError(
        `no web/${PANEL_STYLESHEET} in the jigdaw checkout at ${this.repoPath}; ` +
        'the panel cannot be styled, and a screenshot of an unstyled panel is a ' +
        'valid PNG of a page with no dials in it'
      )
    }
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    const out = path.join(this.cacheDir, `${name}.png`)
    const { profile } = await this.#profileOf(name)

    const height = Math.min(2600, Math.max(800, 520 + (profile.ports?.length || ports) * 22))
    // Upstream's own command, with the browser it defaults to, so there is one
    // photograph of a panel in this system rather than two.
    const result = spawnSync(process.execPath, [
      this.jigCommand(),
      'shot', name,
      '--out', out,
      '--width', String(width),
      '--height', String(height)
    ], {
      encoding: 'utf8',
      env: { ...process.env, CHROME_BIN: this.chrome }
    })

    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().slice(0, 400)
      throw new ScreenshotError(
        `could not render ${name}: ${detail || `jig.js shot exited ${result.status}`}`
      )
    }
    // Checked rather than trusted. The command exits 0 and writes nothing
    // under enough conditions to be worth naming, and an empty file here would
    // be stored as a picture that renders as a broken image on a plugin page.
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      throw new ScreenshotError(`jig.js shot reported success for ${name} but wrote no image at ${out}`)
    }
    return { buffer: await fs.promises.readFile(out), source: 'rendered' }
  }

  /**
   * The port count upstream will render at, read through its own profile
   * reader rather than guessed.
   *
   * @returns {Promise<{profile: object}>}
   */
  async #profileOf (name) {
    const { resolveProfile } = await import(pathToFileURL(this.jigCommand()).href)
    const { profile } = await resolveProfile(name)
    return { profile }
  }

  /**
   * One plugin's screenshot: the one upstream ships, or a fresh render.
   *
   * @returns {Promise<{buffer: Buffer, source: string}>}
   */
  async forPlugin (name, options = {}) {
    const shipped = this.shippedPath(name)
    if (shipped) {
      return { buffer: await fs.promises.readFile(shipped), source: 'shipped' }
    }
    return this.render(name, options)
  }
}

export default JigDawScreenshots