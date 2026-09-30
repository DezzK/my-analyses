/**
 * Where releases are published and how the app finds them. The build config, the release script,
 * the install script and the app's updaters all read these; nothing else spells them out.
 * Only relative imports here: the build config and the release script load this file outside Vite.
 */

/** The bundle identifier on macOS and the application id on Windows. */
export const APP_ID = 'io.github.dezzk.my-analyses'

/** GitHub repository whose releases carry the installers and the update files. */
export const RELEASE_REPO = { owner: 'DezzK', repo: 'my-analyses' } as const

/** Every release carries the macOS builds' description under this name for the app's own updater. */
export const MAC_FEED_FILE = 'latest-mac.json'

/** The macOS install script, also a file of every release. */
export const MAC_INSTALL_SCRIPT = 'install.sh'

/**
 * A shell function, `replace_bundle <installed> <new>`, that moves a new app bundle in place of the
 * installed one and brings the old one back if the new one cannot be moved in. The app's updater
 * runs it after the app quits; the install script, once it has closed the app.
 */
export const REPLACE_BUNDLE_SH = `replace_bundle() {
  previous="$2.previous"
  rm -rf "$previous"
  if [ -e "$1" ] && ! mv "$1" "$previous"; then return 1; fi
  if mv "$2" "$1"; then rm -rf "$previous"; return 0; fi
  if [ -e "$previous" ]; then mv "$previous" "$1"; fi
  return 1
}`

/** Processor architectures the macOS builds are made for, named as Node's `process.arch`. */
export const MAC_ARCHES = ['arm64', 'x64'] as const
export type MacArch = (typeof MAC_ARCHES)[number]

const RELEASES_URL = `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases`

/** A file of the newest release: GitHub redirects this address to it. */
export function latestReleaseFileUrl(file: string): string {
  return `${RELEASES_URL}/latest/download/${file}`
}

/** A file of the release of `version`. */
export function releaseFileUrl(version: string, file: string): string {
  return `${RELEASES_URL}/download/${releaseTag(version)}/${file}`
}

export function releaseTag(version: string): string {
  return `v${version}`
}

/** One macOS build: a zip of the signed app. */
export interface MacBuild {
  url: string
  /** Hex SHA-512 of the zip. */
  sha512: string
  size: number
}

/** What `MAC_FEED_FILE` says: the version and a build per architecture. */
export interface MacFeed {
  version: string
  releaseDate: string
  builds: Partial<Record<MacArch, MacBuild>>
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/

/** A version as its three numbers, or null for anything else (pre-releases are not published). */
function versionParts(version: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Whether `candidate` is a later version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate)
  const b = versionParts(current)
  if (!a || !b) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

function isMacBuild(value: unknown): value is MacBuild {
  if (typeof value !== 'object' || value === null) return false
  const build = value as Record<string, unknown>
  return (
    typeof build['url'] === 'string' &&
    build['url'].startsWith(`${RELEASES_URL}/`) &&
    typeof build['sha512'] === 'string' &&
    SHA512_HEX_PATTERN.test(build['sha512']) &&
    typeof build['size'] === 'number' &&
    build['size'] > 0
  )
}

/**
 * Reads a feed as published, refusing one that is malformed or that points anywhere but this
 * repository's releases; the builds it names are still checked once downloaded.
 */
export function parseMacFeed(text: string): MacFeed {
  const data = JSON.parse(text) as Record<string, unknown>
  const version = data['version']
  if (typeof version !== 'string' || !versionParts(version)) throw new Error('The update feed has no version')
  const raw = (data['builds'] ?? {}) as Record<string, unknown>
  const builds: MacFeed['builds'] = {}
  for (const arch of MAC_ARCHES) {
    const build = raw[arch]
    if (build === undefined) continue
    if (!isMacBuild(build)) throw new Error(`The update feed describes the ${arch} build wrongly`)
    builds[arch] = build
  }
  return { version, releaseDate: String(data['releaseDate'] ?? ''), builds }
}
