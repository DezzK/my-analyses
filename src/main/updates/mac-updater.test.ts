import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAC_FEED_FILE, releaseFileUrl, type MacFeed } from '@shared/release'
import { createSigningIdentity, signMacApp, type SigningIdentity } from '../../../scripts/mac-signing.mts'
import { MacUpdater } from './mac-updater'

const execFileAsync = promisify(execFile)
const INSTALLED = '1.0.0'
const NEWER = '1.1.0'
/** Creating keys and signing bundles takes seconds, not the default few. */
const SIGNING_TIMEOUT_MS = 60_000

/** A tiny app bundle, signed the way releases are. */
async function bundle(folder: string, version: string, identity: SigningIdentity): Promise<string> {
  const app = join(folder, 'Test.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.example.updater-test</string>
<key>CFBundleExecutable</key><string>Test</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`,
  )
  copyFileSync('/usr/bin/true', join(app, 'Contents', 'MacOS', 'Test'))
  writeFileSync(join(app, 'Contents', 'Resources', 'data.txt'), `version ${version}\n`)
  await signMacApp(app, identity)
  return app
}

function zipOf(app: string): Buffer {
  const zip = `${app}.zip`
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
  return readFileSync(zip)
}

function versionOf(app: string): string {
  return execFileSync('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    join(app, 'Contents', 'Info.plist'),
  ])
    .toString()
    .trim()
}

describe.runIf(process.platform === 'darwin')('macOS updates', () => {
  let dir: string
  let ours: SigningIdentity
  let theirs: SigningIdentity
  let installed: string
  let case_ = 0

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'my-analyses-updater-'))
    ours = createSigningIdentity(join(dir, 'ours'), 'My Analyses Updater Test')
    theirs = createSigningIdentity(join(dir, 'theirs'), 'Someone Else')
  }, SIGNING_TIMEOUT_MS)

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** An installed app and an updater offered `zip` as the newer version, as a fresh case. */
  async function setUp(
    zip: Buffer,
    { sha512 = createHash('sha512').update(zip).digest('hex'), currentVersion = INSTALLED } = {},
  ) {
    const root = join(dir, `case-${++case_}`)
    installed = await bundle(join(root, 'Applications'), INSTALLED, ours)
    const feed: MacFeed = {
      version: NEWER,
      releaseDate: '2026-10-01',
      builds: { arm64: { url: releaseFileUrl(NEWER, 'Test.zip'), sha512, size: zip.length } },
    }
    const spawned: string[][] = []
    const quitListeners: (() => void)[] = []
    const updater = new MacUpdater({
      fetch: async (url) =>
        new Response(url.endsWith(MAC_FEED_FILE) ? JSON.stringify(feed) : new Uint8Array(zip)),
      run: (command, args) => execFileAsync(command, args, { encoding: 'utf8' }),
      spawnDetached: (command, args) => spawned.push([command, ...args]),
      bundle: installed,
      stagingDir: join(root, 'staging'),
      currentVersion,
      arch: 'arm64',
      // A process that has exited already, so the swap does not wait.
      pid: spawnSync('/usr/bin/true').pid,
      quit: () => {},
      onQuit: (listener) => quitListeners.push(listener),
    })
    return { updater, spawned, quit: () => quitListeners.forEach((listener) => listener()) }
  }

  async function newer(identity: SigningIdentity, alter?: (app: string) => void): Promise<Buffer> {
    const app = await bundle(join(dir, `build-${++case_}`), NEWER, identity)
    alter?.(app)
    return zipOf(app)
  }

  it(
    'puts an update signed like the app in its place once the app quits',
    async () => {
      const { updater, spawned, quit } = await setUp(await newer(ours))
      expect(await updater.check()).toBe(NEWER)
      await updater.download(() => {})
      updater.install(false)
      expect(spawned).toEqual([])
      quit()
      expect(spawned).toHaveLength(1)
      const [command, ...args] = spawned[0] ?? []
      execFileSync(command ?? '', args)
      expect(versionOf(installed)).toBe(NEWER)
    },
    SIGNING_TIMEOUT_MS,
  )

  it(
    'refuses an update signed by another key',
    async () => {
      const { updater } = await setUp(await newer(theirs))
      await updater.check()
      await expect(updater.download(() => {})).rejects.toThrow('чужим ключом')
    },
    SIGNING_TIMEOUT_MS,
  )

  it(
    'refuses an update changed after it was signed',
    async () => {
      const zip = await newer(ours, (app) =>
        writeFileSync(join(app, 'Contents', 'Resources', 'data.txt'), 'changed'),
      )
      const { updater } = await setUp(zip)
      await updater.check()
      await expect(updater.download(() => {})).rejects.toThrow('чужим ключом или повреждено')
    },
    SIGNING_TIMEOUT_MS,
  )

  it(
    'refuses a download that does not match the checksum of the feed',
    async () => {
      const { updater } = await setUp(await newer(ours), { sha512: 'b'.repeat(128) })
      await updater.check()
      await expect(updater.download(() => {})).rejects.toThrow('повреждено')
    },
    SIGNING_TIMEOUT_MS,
  )

  it(
    'offers nothing when the feed has no newer version',
    async () => {
      const { updater } = await setUp(await newer(ours), { currentVersion: NEWER })
      expect(await updater.check()).toBeNull()
    },
    SIGNING_TIMEOUT_MS,
  )
})
