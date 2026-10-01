import fs from 'fs'
import os from 'os'
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
 * **Two sources, in order.** jigdaw already ships a screenshot per plugin at
 * `web/gallery/shots/<name>.png`, taken by `node bin/build-gallery.js`. Where
 * one exists it is used as-is: it is the upstream's own, it costs nothing, and
 * re-rendering it would only produce a different hash for the same panel. Five
 * plugins have none (`canticle`, `counterpointer`, `dice`, `keyframe`,
 * `midifilter` as of 2026-10-01), and those are rendered here.
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
 * Named once and used twice — once to check it exists and once to link it —
 * because the failure it guards is a stylesheet that 404s: the page still
 * renders, the screenshot is still a valid PNG, and the panel comes out
 * unstyled with nothing anywhere reporting a problem.
 */
const PANEL_STYLESHEET = 'panel.css'

export class JigDawScreenshots {
  /**
   * @param {object} options
   * @param {string} options.repoPath - the jigdaw checkout
   * @param {string} [options.cacheDir] - where rendered panels are kept between
   *   runs. Under data/cache/ so it is neither committed nor an image the
   *   catalogue serves: `ImageStore` holds the one the site links to.
   *   Resolved against the process's working directory, because the path is
   *   handed to `jig.js` as `--out` and that is run with *its* repository as
   *   its cwd — a relative path would land the file in the jigdaw checkout.
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
   * **Realpath'd, and that is not tidiness.** `bin/jig.js` decides it was
   * invoked by comparing `process.argv[1]` with its own resolved `import.meta.url`
   * — so reached through a symlink the two differ, `main()` never runs, and the
   * process exits 0 having written nothing. `/home/danny/github/jigdaw` is a
   * symlink to `/chalet/github/jigdaw` on this machine, which made every render
   * silently produce no file; the check below catches that rather than trusting
   * the exit status, because an exit status of 0 with no picture is exactly the
   * failure this method exists to make visible.
   *
   * Worth fixing upstream in jigdaw (compare resolved paths, or use
   * `import.meta.url === pathToFileURL(process.argv[1]).href` after resolving),
   * where it affects anyone whose checkout is symlinked.
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
   * Panel HTML with the stylesheet `bin/jig.js` forgot, rendered to a file.
   *
   * **A workaround for an upstream bug, and the reason it is here rather than
   * patched into jigdaw.** `bin/jig.js` photographs a panel by inlining the
   * `<style>` block out of `web/index.html`. That block no longer holds the
   * panel's styles: they were moved into `web/panel.css`, which `index.html`
   * *links* and `jig.js` never reads. So `jig.js shot` photographs an unstyled
   * page — labels and bare `<select>`s down the left, every dial invisible, a
   * fraction of the panel drawn. It exits 0 and writes a valid PNG, so nothing
   * reports a problem and the failure is only visible by looking at the picture.
   *
   * It is fixed by adding a `<link>` to the generated document. The page is
   * written into the checkout's own `web/` directory so that link is the same
   * relative href `index.html` uses — the panel is drawn by the stylesheet the
   * host itself loads, not by a copy of it kept here, which would be a second
   * thing to keep correct. Worth reporting upstream: `panelStyle()` should
   * concatenate `panel.css`, or the generated page should link it. Once it
   * does, this can go back to calling `jig.js shot` and nothing else.
   *
   * @returns {Promise<{page: string, dir: string, profile: object}>}
   */
  async #panelPage (name) {
    const { resolveProfile, renderPanelHTML } = await import(
      pathToFileURL(this.jigCommand()).href
    )
    const { profile } = await resolveProfile(name)
    const html = await renderPanelHTML(profile)
    // The page is written beside panel.css, so this is the same href
    // web/index.html uses. The file's existence is checked in render(), before
    // this; a stylesheet that 404s renders as no stylesheet at all, silently.
    const linked = html.replace(
      '</head>',
      `<link rel="stylesheet" href="${PANEL_STYLESHEET}">\n</head>`
    )
    if (linked === html) {
      throw new ScreenshotError(
        `${name}: could not attach panel.css — renderPanelHTML produced no </head> to add it to`
      )
    }

    const dir = path.join(this.repoPath, 'web')
    const page = path.join(dir, `.panel-${process.pid}-${name}.html`)
    try {
      await fs.promises.writeFile(page, linked)
    } catch (error) {
      throw new ScreenshotError(
        `${name}: could not write ${page} — ${error.message}. ` +
        'The panel page is written into the jigdaw checkout so its relative ' +
        'stylesheet link resolves; a read-only checkout means no screenshot.'
      )
    }
    return { page, profile }
  }

  /**
   * Render one plugin's panel and photograph it.
   *
   * The viewport height is derived from the port count the way
   * `bin/build-gallery.js` derives it, rather than fixed: a panel with 40
   * controls shot at 700px is a cropped fragment, and a cropped screenshot
   * published as *the* picture of a plugin is worse than none.
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
    // Before anything is rendered, and before jigdaw's own module is loaded:
    // an unstyled panel is a valid PNG of nothing, so the cheapest honest
    // answer to "the stylesheet is missing" is to refuse rather than to write
    // a picture that looks like a broken plugin.
    if (!fs.existsSync(path.join(this.repoPath, 'web', PANEL_STYLESHEET))) {
      throw new ScreenshotError(
        `no web/${PANEL_STYLESHEET} in the jigdaw checkout at ${this.repoPath}; ` +
        'the panel cannot be styled, and a screenshot of an unstyled panel is a ' +
        'valid PNG of a page with no dials in it'
      )
    }
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    const out = path.join(this.cacheDir, `${name}.png`)
    const { page, profile } = await this.#panelPage(name)

    try {
      const height = Math.min(2600, Math.max(800, 520 + (profile.ports?.length || ports) * 22))
      // The same flags bin/jig.js shot uses, and no more: this is the same
      // photograph of the same page, with the stylesheet it forgot.
      const result = spawnSync(this.chrome, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        pathToFileURL(page).href
      ], { encoding: 'utf8' })

      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || '').trim().slice(0, 400)
        throw new ScreenshotError(
          `could not render ${name}: ${detail || `Chrome exited ${result.status}`}`
        )
      }
      // Checked rather than trusted. Chrome exits 0 and writes nothing under
      // enough conditions to be worth naming, and an empty file here would be
      // stored as a picture that renders as a broken image on a plugin page.
      if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
        throw new ScreenshotError(`Chrome reported success for ${name} but wrote no image at ${out}`)
      }
      return { buffer: await fs.promises.readFile(out), source: 'rendered' }
    } finally {
      // The generated page lives in the checkout's web/ only for as long as
      // the photograph takes; leaving one per plugin per run behind is how a
      // working tree fills with files nobody meant to create.
      await fs.promises.rm(page, { force: true })
    }
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
