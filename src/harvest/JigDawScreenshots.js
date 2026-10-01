import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

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
   * Render one plugin's panel and photograph it.
   *
   * The viewport height is derived from the port count the way
   * `bin/build-gallery.js` derives it, rather than fixed: a panel with 40
   * controls shot at 700px is a cropped fragment, and a cropped screenshot
   * published as *the* picture of a plugin is worse than none.
   *
   * @param {string} name - the plugin directory name under plugins/
   * @param {object} [options]
   * @param {number} [options.ports] - how many ports the panel has
   */
  async render (name, { ports = 0, width = 1100 } = {}) {
    if (!this.canRender) {
      throw new ScreenshotError(`no Chrome at ${this.chrome}; set CHROME_BIN to render panels`)
    }
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    const out = path.join(this.cacheDir, `${name}.png`)

    const height = Math.min(2600, Math.max(800, 520 + ports * 22))
    const result = spawnSync(process.execPath, [
      this.jigCommand(),
      'shot', name, '--out', out, '--width', String(width), '--height', String(height)
    ], { encoding: 'utf8', cwd: this.repoPath })

    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().slice(0, 400)
      throw new ScreenshotError(`could not render ${name}: ${detail || `jig.js exited ${result.status}`}`)
    }
    if (!fs.existsSync(out)) {
      throw new ScreenshotError(`jig.js reported success for ${name} but wrote no file at ${out}`)
    }
    return { buffer: await fs.promises.readFile(out), source: 'rendered' }
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
