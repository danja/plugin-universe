import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * What a plugin runs on, and how to recognise it in what a source said.
 *
 * Three individuals and one way of arriving at them. The catalogue held this
 * fact for 559 plugins before this module existed — `pu:operatingSystem`
 * strings on package files, written by the Open Audio Stack harvester since
 * Phase 1 — and `grep -rn 'operatingSystem' sparql/queries/` returned exactly
 * one query, the registry index. Stored, never read: the third instance of the
 * failure at the top of CLAUDE.md, and the one this module is the write half of.
 *
 * **This is the list.** `vocabs/plugin-universe.ttl` defines the individuals,
 * `vocabs/shapes.ttl` enumerates them in `sh:in`, `FACET_PATTERNS.platform`
 * mints them back out of a URL, and the submission form offers them.
 * `tests/harvest/platforms.test.js` asserts all four agree, because four copies
 * of a list reviewed carefully is worth less than two bound by a test.
 */

const pu = NAMESPACES.pu

export const WINDOWS = `${pu}Windows`
export const MACOS = `${pu}MacOS`
export const LINUX = `${pu}Linux`

/** The platform IRIs a harvester may assert, in the order a page shows them. */
export const PLATFORMS = Object.freeze([WINDOWS, MACOS, LINUX])

/**
 * Tokens that identify a platform, and the platform they identify.
 *
 * Two sources feed this and they speak differently. The Open Audio Stack
 * manifest says `win`, `mac`, `linux`. A GitHub release asset says whatever its
 * author's build script called it — every spelling below was read off a real
 * filename in the catalogue, not imagined:
 *
 *     master_me-1.3.1-win64.zip        amsynth-2.0.0-windows.exe
 *     master_me-1.3.1-macos-universal.dmg   dm-BigMuff-ubuntu.zip
 *     master_me-1.3.1-linux-riscv64.tar.xz
 *
 * Matched as whole tokens against a filename split on non-alphanumerics, so
 * `win` does not match `winter` and `mac` does not match `macro`. That is why
 * this is a table of exact tokens rather than a list of substrings: the naive
 * version classifies `master_me-1.3.1-src.tar.xz` as nothing and
 * `MyMacroPlugin.zip` as macOS.
 *
 * A distribution is not a platform — `ubuntu` maps to Linux because that is
 * what an Ubuntu build is, not because the catalogue distinguishes them. MOD
 * device builds (`modduo`, `moddwarf`) are deliberately absent: they are
 * embedded ARM Linux appliances rather than a desktop anybody installs a plugin
 * on, and every repository that ships one also ships an `ubuntu` asset, so
 * including them would add no plugin and one wrong claim.
 */
export const PLATFORM_TOKENS = Object.freeze({
  win: WINDOWS,
  win32: WINDOWS,
  win64: WINDOWS,
  windows: WINDOWS,
  mingw: WINDOWS,
  exe: WINDOWS,
  msi: WINDOWS,
  mac: MACOS,
  macos: MACOS,
  macosx: MACOS,
  osx: MACOS,
  darwin: MACOS,
  dmg: MACOS,
  pkg: MACOS,
  linux: LINUX,
  ubuntu: LINUX,
  debian: LINUX,
  fedora: LINUX,
  deb: LINUX,
  appimage: LINUX,
  flatpak: LINUX
})

/**
 * The platform a source's own word for one means, or null.
 *
 * Null rather than a throw: a source is free to say something this catalogue
 * has no individual for, and dropping the value is right where inventing a
 * fourth platform is not. The caller keeps whatever the source actually said —
 * `pu:operatingSystem` on the file is untouched by any of this.
 */
export function toPlatform (raw) {
  if (!raw || typeof raw !== 'string') return null
  return PLATFORM_TOKENS[raw.trim().toLowerCase()] ?? null
}

/**
 * Every platform token in a filename or a URL.
 *
 * Split on anything that is not a letter or a digit, which is how release
 * assets are actually named — `master_me-1.3.1-linux-riscv64.tar.xz` yields
 * `master`, `me`, `1`, `3`, `1`, `linux`, `riscv64`, `tar`, `xz`, and exactly
 * one of those is a platform.
 *
 * The whole URL is tokenised rather than the last segment alone, and that is a
 * deliberate widening with a cost: a repository named `linux-audio-things`
 * would mark every one of its assets as Linux. The alternative — matching only
 * the filename — misses assets whose platform is in the tag or the directory,
 * which is common enough to matter. Since a GitHub asset URL always ends in the
 * filename, callers that only want the filename pass it.
 */
export function platformsInName (name) {
  const found = new Set()
  for (const token of String(name ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    const platform = PLATFORM_TOKENS[token]
    if (platform) found.add(platform)
  }
  return [...found]
}

/**
 * What a plugin's packages say it runs on.
 *
 * Two kinds of evidence, in order of how much they are worth:
 *
 *  1. **`file.systems`** — the source stated it. The Open Audio Stack manifest
 *     carries this for all 559 of its plugins, and a statement beats an
 *     inference from a name every time.
 *  2. **The download's filename** — `dm-BigMuff-windows.zip` is a Windows
 *     build, and a repository that publishes one is a repository whose plugin
 *     runs on Windows. Weaker than (1), and still evidence rather than a guess:
 *     the claim is about an artefact somebody built and published, not about
 *     what the plugin might compile for.
 *
 * A file that yields neither contributes nothing — `amsynth-2.0.0.tar.gz` is a
 * source tarball and says nothing about platforms, which is the correct reading
 * and the reason this returns a possibly-empty list rather than a default.
 *
 * `pu:sourceAvailability` is derived from a licence this way too, and the same
 * rule applies: absent means nobody has said, not "no".
 */
export function platformsFromPackages (packages = []) {
  const found = new Set()
  for (const pkg of packages) {
    for (const file of pkg.files ?? []) {
      for (const system of file.systems ?? []) {
        const platform = toPlatform(system)
        if (platform) found.add(platform)
      }
      // Only when the source said nothing about this file. A manifest that
      // states `linux` for an asset called `foo-x86_64.tar.gz` is right and the
      // filename is silent; a manifest that states nothing is where the name
      // becomes the only thing there is to read.
      if ((file.systems ?? []).length === 0) {
        for (const platform of platformsInName(file.url)) found.add(platform)
      }
    }
  }
  // Fixed order, so the same evidence produces the same triples run after run
  // and a re-harvest is a no-op rather than a diff.
  return PLATFORMS.filter(platform => found.has(platform))
}

export default platformsFromPackages
