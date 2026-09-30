/**
 * The steps of a release. CI runs them when a `v<version>` tag is pushed
 * (`.github/workflows/release.yml`): each platform's build puts the files it publishes in
 * `PUBLISH_DIR`, and the last step publishes that folder as the GitHub release.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { build } from 'electron-builder'
import {
  APP_ID,
  latestReleaseFileUrl,
  MAC_ARCHES,
  MAC_FEED_FILE,
  MAC_INSTALL_SCRIPT,
  RELEASE_REPO,
  releaseFileUrl,
  releaseTag,
  REPLACE_BUNDLE_SH,
  type MacArch,
  type MacFeed,
} from '../src/shared/release.ts'
import { importSigningIdentity, signingIdentity } from './mac-signing.mts'

export const PLATFORMS = ['mac', 'windows', 'linux'] as const
export type Platform = (typeof PLATFORMS)[number]

/** Where each platform's build leaves the files the release publishes. */
export const PUBLISH_DIR = 'release/publish'

/** The CI secret holding the base64 of the macOS signing identity's .p12. */
export const SIGNING_SECRET = 'MAC_SIGNING_P12'

/** What electron-updater reads to update the app, written by electron-builder next to the build. */
const UPDATER_FEEDS = { windows: 'latest.yml', linux: 'latest-linux.yml' } as const

const { version, productName } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string
  productName: string
}
const repo = `${RELEASE_REPO.owner}/${RELEASE_REPO.repo}`
const tag = releaseTag(version)

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

/** Runs a command whose own output the person should see. */
function show(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' })
}

/** Runs an npm script: npm is a batch file on Windows, which only a shell can start. */
function npmRun(script: string): void {
  execFileSync('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' })
}

function sha512Of(file: string): string {
  return createHash('sha512').update(readFileSync(file)).digest('hex')
}

function toPublish(files: string[]): void {
  mkdirSync(PUBLISH_DIR, { recursive: true })
  for (const file of files) copyFileSync(file, join(PUBLISH_DIR, basename(file)))
}

/** Tags the version in package.json and pushes it, once every check passes here. */
export function tagAndPush(): void {
  if (run('git', ['status', '--porcelain']).trim()) {
    throw new Error('Commit the changes first: a release is built from a clean tree')
  }
  if (run('git', ['tag', '--list', tag]).trim()) throw new Error(`${tag} exists already: raise the version`)
  npmRun('check')
  show('git', ['tag', tag])
  show('git', ['push', 'origin', 'HEAD', tag])
  console.log(`\nPushed ${tag}: CI builds and publishes it, https://github.com/${repo}/actions`)
}

/** On CI: puts the signing identity from its secret where the macOS build looks for it. */
export function importIdentity(): void {
  const p12 = process.env[SIGNING_SECRET]
  if (!p12) {
    throw new Error(`${SIGNING_SECRET} is empty: add the signing identity to the repository's secrets`)
  }
  console.log(`Signing identity ${importSigningIdentity(Buffer.from(p12, 'base64')).sha1} is ready`)
}

async function buildMac(): Promise<void> {
  const identity = signingIdentity()
  const zips = new Map<MacArch, string>()
  for (const arch of MAC_ARCHES) {
    const zip = (await build({ mac: ['zip'], [arch]: true, publish: 'never' })).find((f) =>
      f.endsWith('.zip'),
    )
    if (!zip) throw new Error(`The ${arch} build made no zip`)
    zips.set(arch, zip)
  }
  toPublish([...zips.values()])

  const feed: MacFeed = { version, releaseDate: new Date().toISOString(), builds: {} }
  for (const [arch, zip] of zips) {
    feed.builds[arch] = {
      url: releaseFileUrl(version, basename(zip)),
      sha512: sha512Of(zip),
      size: statSync(zip).size,
    }
  }
  writeFileSync(join(PUBLISH_DIR, MAC_FEED_FILE), `${JSON.stringify(feed, null, 2)}\n`)

  const values: Record<string, string> = {
    INSTALL_COMMAND: macInstallCommand(),
    FEED_URL: latestReleaseFileUrl(MAC_FEED_FILE),
    APP_ID,
    REQUIREMENT: `identifier "${APP_ID}" and certificate leaf = H"${identity.sha1.toLowerCase()}"`,
    REPLACE_BUNDLE: REPLACE_BUNDLE_SH,
  }
  const script = readFileSync('scripts/install-macos.sh', 'utf8').replace(
    /@([A-Z_]+)@/g,
    (_, name: string) => {
      const value = values[name]
      if (value === undefined) throw new Error(`The install script asks for an unknown @${name}@`)
      return value
    },
  )
  writeFileSync(join(PUBLISH_DIR, MAC_INSTALL_SCRIPT), script, { mode: 0o755 })
}

async function buildWindows(): Promise<void> {
  const files = await build({ win: ['nsis'], x64: true, publish: 'never' })
  // The installer and its blockmap, which electron-updater downloads, and its feed.
  const installer = files.filter((f) => f.endsWith('.exe') || f.endsWith('.exe.blockmap'))
  toPublish([...installer, join(dirname(installer[0] ?? ''), UPDATER_FEEDS.windows)])
}

async function buildLinux(): Promise<void> {
  const image = (await build({ linux: ['AppImage'], x64: true, publish: 'never' })).filter((f) =>
    f.endsWith('.AppImage'),
  )
  toPublish([...image, join(dirname(image[0] ?? ''), UPDATER_FEEDS.linux)])
}

const BUILDS: Record<Platform, () => Promise<void>> = {
  mac: buildMac,
  windows: buildWindows,
  linux: buildLinux,
}

/** Builds one platform from a fresh bundle of the app into an emptied `PUBLISH_DIR`. */
export async function buildPlatform(platform: Platform): Promise<void> {
  rmSync(PUBLISH_DIR, { recursive: true, force: true })
  npmRun('build')
  await BUILDS[platform]()
}

function macInstallCommand(): string {
  return `curl -fsSL ${latestReleaseFileUrl(MAC_INSTALL_SCRIPT)} | bash`
}

/** Publishes what every platform's build gathered, as the release of the pushed tag. */
export function publish(): void {
  const pushed = process.env['GITHUB_REF_NAME']
  if (pushed && pushed !== tag) {
    throw new Error(`The tag ${pushed} is not the version ${version} of package.json`)
  }
  const files = readdirSync(PUBLISH_DIR).sort()
  for (const feed of [MAC_FEED_FILE, UPDATER_FEEDS.windows, UPDATER_FEEDS.linux]) {
    if (!files.includes(feed)) throw new Error(`${feed} is missing: every platform is published at once`)
  }
  const named = (suffix: string) => files.find((file) => file.endsWith(suffix)) ?? ''
  const notes = [
    '**Mac**: установка и переустановка — одной командой в Терминале:',
    '',
    `    ${macInstallCommand()}`,
    '',
    `**Windows**: скачайте и запустите ${named('.exe')}. Windows предупредит о неизвестном издателе:`,
    'нажмите «Подробнее» → «Выполнить в любом случае».',
    '',
    `**Linux**: скачайте ${named('.AppImage')}, разрешите запуск (\`chmod +x\`) и запустите.`,
    '',
    'Дальше установленное приложение обновляется само.',
  ].join('\n')
  show('gh', [
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--title',
    `${productName} ${version}`,
    '--notes',
    notes,
    ...files.map((file) => join(PUBLISH_DIR, file)),
  ])
}
