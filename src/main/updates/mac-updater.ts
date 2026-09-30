import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, constants, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { UserError } from '@shared/errors'
import {
  isNewerVersion,
  latestReleaseFileUrl,
  MAC_FEED_FILE,
  parseMacFeed,
  REPLACE_BUNDLE_SH,
  type MacArch,
  type MacBuild,
} from '@shared/release'
import type { Updater } from './updater'

/** What the updater needs from the system, so tests can stand in for it. */
export interface MacUpdaterDeps {
  fetch: (url: string) => Promise<Response>
  /** Runs a command, resolving with its output, rejecting when it fails. */
  run: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  /** Starts a command that outlives the app. */
  spawnDetached: (command: string, args: string[]) => void
  /** The running app's bundle, `…/Мои анализы.app`. */
  bundle: string
  /** A folder of the updater's own, emptied at will. */
  stagingDir: string
  currentVersion: string
  arch: MacArch
  pid: number
  quit: () => void
  /** Calls `listener` once when the app is about to quit. */
  onQuit: (listener: () => void) => void
}

const CODESIGN = '/usr/bin/codesign'
const DITTO = '/usr/bin/ditto'
const PLUTIL = '/usr/bin/plutil'

/** Replaces the app once it has quit: $1 its pid, $2 the installed bundle, $3 the new one, $4 "1" to open it. */
const SWAP_SCRIPT = `#!/bin/sh
${REPLACE_BUNDLE_SH}
pid="$1"; target="$2"; staged="$3"; reopen="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
replace_bundle "$target" "$staged"
if [ "$reopen" = 1 ]; then open "$target"; fi
`

/** The line of `codesign -d -r-` that states the designated requirement. */
const DESIGNATED = 'designated => '

/**
 * macOS updates without Apple's services: the feed of the latest release names a zip per
 * architecture; the zip must match its SHA-512, and the app inside must be signed by the same
 * certificate as the running app (its designated requirement) and carry the announced version.
 * Only then is it moved in place of the running app, after the app quits.
 */
export class MacUpdater implements Updater {
  private found: { version: string; build: MacBuild } | null = null
  private staged: string | null = null
  private swapStarted = false
  private armedForQuit = false

  constructor(private readonly deps: MacUpdaterDeps) {}

  async check(): Promise<string | null> {
    if (this.staged) return this.found?.version ?? null
    const response = await this.deps.fetch(latestReleaseFileUrl(MAC_FEED_FILE))
    if (!response.ok) throw new UserError('Сервер обновлений не ответил')
    const feed = parseMacFeed(await response.text())
    const build = feed.builds[this.deps.arch]
    if (!build || !isNewerVersion(feed.version, this.deps.currentVersion)) return null
    this.found = { version: feed.version, build }
    return feed.version
  }

  async download(progress: (share: number) => void): Promise<void> {
    const found = this.found
    if (!found) throw new Error('Nothing to download: check first')
    await this.assertReplaceable()
    const requirement = await this.ownRequirement()
    const { stagingDir } = this.deps
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })
    const zip = join(stagingDir, 'update.zip')
    await this.fetchTo(found.build, zip, progress)

    const unpacked = join(stagingDir, 'unpacked')
    await this.deps.run(DITTO, ['-x', '-k', zip, unpacked])
    const apps = (await readdir(unpacked)).filter((name) => name.endsWith('.app'))
    if (apps.length !== 1 || !apps[0]) throw new UserError('В обновлении нет приложения')
    const candidate = join(unpacked, apps[0])
    await this.verify(candidate, requirement, found.version)
    // Written now: when the app quits there is no time left to write anything.
    await writeFile(this.swapScript(), SWAP_SCRIPT, { mode: 0o755 })
    this.staged = candidate
  }

  install(restart: boolean): void {
    if (!this.staged) return
    if (restart) {
      this.swapAfterExit(true)
      this.deps.quit()
    } else if (!this.armedForQuit) {
      this.armedForQuit = true
      this.deps.onQuit(() => this.swapAfterExit(false))
    }
  }

  /** Moving the app needs the right to change the folder it is in, `/Applications` usually. */
  private async assertReplaceable(): Promise<void> {
    const folder = dirname(this.deps.bundle)
    try {
      await access(folder, constants.W_OK)
    } catch {
      throw new UserError(
        `Нет прав заменить приложение в папке «${folder}». Установите новую версию командой установки.`,
      )
    }
  }

  /** The requirement every version of this app is signed to satisfy; none for an unsigned app. */
  private async ownRequirement(): Promise<string> {
    const output = await this.deps.run(CODESIGN, ['-d', '-r-', this.deps.bundle]).catch(() => null)
    const lines = output ? `${output.stdout}\n${output.stderr}`.split('\n') : []
    const requirement = lines
      .find((line) => line.startsWith(DESIGNATED))
      ?.slice(DESIGNATED.length)
      .trim()
    // An ad-hoc signature names the exact binary: no other version could ever satisfy it.
    if (!requirement || requirement.startsWith('cdhash')) {
      throw new UserError('Приложение не подписано, поэтому не может проверить обновление')
    }
    return requirement
  }

  private async verify(candidate: string, requirement: string, version: string): Promise<void> {
    try {
      await this.deps.run(CODESIGN, ['--verify', '--deep', '--strict', '-R', `=${requirement}`, candidate])
    } catch {
      throw new UserError('Обновление подписано чужим ключом или повреждено, оно не будет установлено')
    }
    const plist = join(candidate, 'Contents', 'Info.plist')
    const { stdout } = await this.deps.run(PLUTIL, [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      plist,
    ])
    if (stdout.trim() !== version) {
      throw new UserError(`В обновлении версия ${stdout.trim()} вместо объявленной ${version}`)
    }
  }

  private async fetchTo(build: MacBuild, file: string, progress: (share: number) => void): Promise<void> {
    const response = await this.deps.fetch(build.url)
    if (!response.ok || !response.body) throw new UserError('Не удалось скачать обновление')
    const hash = createHash('sha512')
    let received = 0
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        received += chunk.length
        progress(Math.min(1, received / build.size))
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as ReadableStream), measure, createWriteStream(file))
    if (received !== build.size || hash.digest('hex') !== build.sha512) {
      throw new UserError('Скачанное обновление повреждено')
    }
  }

  private swapScript(): string {
    return join(this.deps.stagingDir, 'swap.sh')
  }

  private swapAfterExit(reopen: boolean): void {
    if (!this.staged || this.swapStarted) return
    this.swapStarted = true
    const { pid, bundle } = this.deps
    this.deps.spawnDetached('/bin/sh', [
      this.swapScript(),
      String(pid),
      bundle,
      this.staged,
      reopen ? '1' : '0',
    ])
  }
}
