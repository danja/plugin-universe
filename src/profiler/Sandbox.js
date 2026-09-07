import { spawn } from 'child_process'
import { PROFILER_CONFIG } from '../../config/preferences.js'

/**
 * Running third-party native code, once, in a box it cannot get out of.
 *
 * This is the only component in the system permitted to execute code the
 * project did not write, and it is the highest-risk thing here by a distance
 * (docs/architecture.md §6). Two principles govern it.
 *
 * **A crash is a result, not an error.** A plugin that segfaults, hangs, forks
 * a thousand threads or fills memory has told us something true about itself,
 * and the profiler's job is to write that down. Nothing below throws because a
 * plugin behaved badly; it throws only when the *sandbox* could not be
 * established, because then the measurement would be a lie.
 *
 * **Confinement is not configuration.** Every flag here is load-bearing and
 * none is a default someone can quietly weaken:
 *
 *   --network none        a plugin scan has no business making a connection,
 *                         and this is the difference between running untrusted
 *                         code and running untrusted code on the internet
 *   --read-only           with an explicit tmpfs, so a plugin writing to disk
 *                         changes nothing that survives the container
 *   --cap-drop ALL        no capabilities at all; nothing here needs one
 *   --security-opt        no-new-privileges, so a setuid binary inside the
 *                         image cannot escalate
 *   --pids-limit          a fork bomb hits a wall rather than the host
 *   --memory / --cpus     bounded, and the plugin mount is read-only
 *   --user                unprivileged; never root, even inside the container
 *
 * A wall-clock timeout is enforced from outside as well as in: a container that
 * ignores SIGTERM is killed.
 */

export class SandboxError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'SandboxError'
    if (cause) this.cause = cause
  }
}

/** How a run ended. Every one of these is a legitimate measurement outcome. */
export const OUTCOME = Object.freeze({
  OK: 'ok',
  FAILED: 'failed',
  CRASHED: 'crashed',
  TIMED_OUT: 'timed-out'
})

/**
 * Exit codes that mean the process died from a signal.
 *
 * A container's exit code is its PID 1's, and when a plugin brings down the
 * tool scanning it, PID 1 is a shell reporting 128 + signal. So the crash the
 * profiler most wants to record — the one the architecture calls "a recorded
 * result, not an error" — arrives as exit 139, with no signal field set at all.
 * Reading that as an ordinary non-zero exit loses the distinction between "this
 * plugin is malformed" and "this plugin took the host process with it".
 */
const SIGNAL_EXIT = Object.freeze({
  129: 'SIGHUP', 130: 'SIGINT', 131: 'SIGQUIT', 132: 'SIGILL', 133: 'SIGTRAP',
  134: 'SIGABRT', 135: 'SIGBUS', 136: 'SIGFPE', 137: 'SIGKILL', 139: 'SIGSEGV',
  141: 'SIGPIPE', 143: 'SIGTERM', 152: 'SIGXCPU', 153: 'SIGXFSZ'
})

/** The signal a run died from, however it was reported. */
export function signalOf ({ code, signal }) {
  return signal ?? SIGNAL_EXIT[code] ?? null
}

export class Sandbox {
  /**
   * @param {object} [options]
   * @param {string} [options.image] - the profiler image
   * @param {string} [options.runtime] - container command; docker or podman
   */
  constructor ({ image = 'plugin-universe-profiler', runtime = 'docker' } = {}) {
    this.image = image
    this.runtime = runtime
  }

  /** True when the container runtime answers at all. */
  async isAvailable () {
    const probe = await this.#spawn([this.runtime, 'image', 'inspect', this.image], 10000)
    return probe.code === 0
  }

  #spawn (argv, timeoutMs) {
    return new Promise(resolve => {
      const started = Date.now()
      const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        // SIGKILL, not SIGTERM: the case this exists for is code that does not
        // respond to a polite request.
        child.kill('SIGKILL')
      }, timeoutMs)

      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', error => {
        clearTimeout(timer)
        resolve({ code: null, signal: null, stdout, stderr: String(error), timedOut, elapsedMs: Date.now() - started, spawnError: error })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal, stdout, stderr, timedOut, elapsedMs: Date.now() - started })
      })
    })
  }

  /**
   * Run one command against one plugin directory.
   *
   * @param {object} spec
   * @param {string} spec.mountPath - host directory holding the plugin. Mounted
   *   read-only at /plugin.
   * @param {string[]} spec.command - argv inside the container
   * @param {number} [spec.timeoutMs]
   * @returns {Promise<object>} the run record, whatever happened
   */
  async run ({ mountPath, command, timeoutMs = PROFILER_CONFIG.wallClockLimitMs }) {
    if (!mountPath) throw new SandboxError('Sandbox.run needs a mountPath')
    if (!Array.isArray(command) || command.length === 0) {
      throw new SandboxError('Sandbox.run needs a command')
    }

    const argv = [
      this.runtime, 'run', '--rm',
      '--network', 'none',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', String(PROFILER_CONFIG.pidsLimit),
      '--memory', `${PROFILER_CONFIG.memoryLimitMb}m`,
      '--memory-swap', `${PROFILER_CONFIG.memoryLimitMb}m`,
      '--cpus', String(PROFILER_CONFIG.cpuLimitCores),
      '--user', String(PROFILER_CONFIG.uid),
      '--volume', `${mountPath}:/plugin:ro`,
      '--workdir', '/tmp',
      this.image,
      ...command
    ]

    // A little beyond the container's own limit, so the outer kill is a
    // backstop for a container that will not die rather than the normal path.
    const result = await this.#spawn(argv, timeoutMs + 5000)

    if (result.spawnError) {
      throw new SandboxError(
        `Could not start the sandbox: ${result.spawnError.message}. ` +
        'Refusing to profile outside it — an unconfined measurement is not one worth having.',
        { cause: result.spawnError }
      )
    }

    return {
      outcome: Sandbox.classify(result),
      exitCode: result.code,
      signal: signalOf(result),
      stdout: result.stdout,
      stderr: result.stderr,
      elapsedMs: result.elapsedMs,
      command
    }
  }

  /**
   * What the run's ending means.
   *
   * A non-zero exit is a failure the tool reported; a signal is the plugin
   * dying. Both are recorded rather than raised — that distinction is the
   * whole design.
   */
  static classify ({ code, signal, timedOut }) {
    if (timedOut) return OUTCOME.TIMED_OUT
    if (signal) return OUTCOME.CRASHED
    if (code === 0) return OUTCOME.OK
    // 128 + signal: the shell's way of reporting that its child died, and how a
    // plugin crash reaches us through a tool. SIGKILL at 137 is also what an
    // out-of-memory kill looks like from outside the container.
    if (SIGNAL_EXIT[code]) return OUTCOME.CRASHED
    return OUTCOME.FAILED
  }
}

export default Sandbox
