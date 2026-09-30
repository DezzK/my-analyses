/**
 * Publishes the version in package.json as a GitHub release: checks the tree and every test,
 * builds the Mac zips and the Windows installer, writes the macOS feed and the install script,
 * then uploads them all. `npm run release`; with `-- --dry-run` it stops before uploading.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
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
import { signingIdentity } from './mac-signing.mts'

/** electron-updater's description of the Windows build, written next to the installer. */
const WINDOWS_FEED_FILE = 'latest.yml'

const dryRun = process.argv.includes('--dry-run')
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

function step(title: string): void {
  console.log(`\n▸ ${title}`)
}

function published(): boolean {
  try {
    run('gh', ['release', 'view', tag, '--repo', repo])
    return true
  } catch {
    return false
  }
}

function sha512Of(file: string): string {
  return createHash('sha512').update(readFileSync(file)).digest('hex')
}

step(`${dryRun ? 'Dry run of the release' : 'Release'} ${version} to ${repo}`)
if (!dryRun && run('git', ['status', '--porcelain']).trim()) {
  throw new Error('Commit the changes first: a release is built from a clean tree')
}
if (published()) throw new Error(`${tag} is published already: raise the version in package.json`)
const identity = signingIdentity()

step('Checks')
show('npm', ['run', 'typecheck'])
show('npm', ['test'])
show('npm', ['run', 'build'])
show('npx', ['playwright', 'test'])

step('Builds')
const macZips = new Map<MacArch, string>()
for (const arch of MAC_ARCHES) {
  const zip = (await build({ mac: ['zip'], [arch]: true, publish: 'never' })).find((f) => f.endsWith('.zip'))
  if (!zip) throw new Error(`The ${arch} build made no zip`)
  macZips.set(arch, zip)
}
const out = dirname([...macZips.values()][0] ?? '')
// The installer and its blockmap, which electron-updater downloads, and its feed.
const windowsFiles = [
  ...(await build({ win: ['nsis'], x64: true, publish: 'never' })).filter(
    (file) => file.endsWith('.exe') || file.endsWith('.exe.blockmap'),
  ),
  join(out, WINDOWS_FEED_FILE),
]

step('macOS feed and install script')
const feed: MacFeed = { version, releaseDate: new Date().toISOString(), builds: {} }
for (const [arch, zip] of macZips) {
  feed.builds[arch] = {
    url: releaseFileUrl(version, basename(zip)),
    sha512: sha512Of(zip),
    size: statSync(zip).size,
  }
}
const feedFile = join(out, MAC_FEED_FILE)
writeFileSync(feedFile, `${JSON.stringify(feed, null, 2)}\n`)
const install = `curl -fsSL ${latestReleaseFileUrl(MAC_INSTALL_SCRIPT)} | bash`
const values: Record<string, string> = {
  INSTALL_COMMAND: install,
  FEED_URL: latestReleaseFileUrl(MAC_FEED_FILE),
  APP_ID,
  REQUIREMENT: `identifier "${APP_ID}" and certificate leaf = H"${identity.sha1.toLowerCase()}"`,
  REPLACE_BUNDLE: REPLACE_BUNDLE_SH,
}
const installScript = join(out, MAC_INSTALL_SCRIPT)
writeFileSync(
  installScript,
  readFileSync('scripts/install-macos.sh', 'utf8').replace(/@([A-Z_]+)@/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`The install script asks for an unknown @${name}@`)
    return value
  }),
  { mode: 0o755 },
)

const notes = [
  `Mac: установка и обновление вручную — команда в Терминале:`,
  '',
  `    ${install}`,
  '',
  `Windows: скачайте и запустите ${basename(windowsFiles.find((f) => f.endsWith('.exe')) ?? '')}.`,
  'Установленное приложение дальше обновляется само.',
].join('\n')
const files = [...macZips.values(), feedFile, installScript, ...windowsFiles]

step(dryRun ? 'Would publish' : 'Publishing')
if (dryRun) {
  console.log(files.join('\n'))
  console.log(`\n${notes}`)
} else {
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
    ...files,
  ])
  show('git', ['tag', tag])
  console.log(`\nPublished ${tag}. Install on a Mac with:\n  ${install}`)
}
