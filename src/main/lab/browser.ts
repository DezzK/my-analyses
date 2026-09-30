import { BrowserWindow, session, shell, type Event, type WebContents } from 'electron'
import { setTimeout as sleep } from 'node:timers/promises'
import { readStorageScript, writeStorageScript } from './page-scripts'
import type { FetchedBytes, FetchInit, FetchedText, LabConnector, LabPage } from './types'

/** Chromium's error for a navigation that was canceled, here by the host guard below. */
const ERR_ABORTED = -3
const LOGIN_WINDOW = { width: 1100, height: 820 }
/** How often the login window asks the connector whether someone has logged in by now. */
const LOGIN_CHECK_INTERVAL_MS = 4_000
/** A request the lab has not answered by then is abandoned, so a sync cannot hang forever. */
const REQUEST_TIMEOUT_MS = 60_000

/** Chrome's reduced user agent: labs see an ordinary browser, not "Electron". */
function browserUserAgent(): string {
  const major = process.versions.chrome.split('.')[0]
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

export function isLabHost(url: string, hosts: readonly string[]): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

const labPagePreferences = (partition: string) => ({
  partition,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
})

/** Bytes per `String.fromCharCode` call when a page turns a file into base64. */
const BASE64_SLICE = 0x8000

/** Requests made from inside the lab's page, so they carry its session; spaced by the connector. */
class WebContentsLabPage implements LabPage {
  private nextRequestAt = 0

  constructor(
    private readonly contents: WebContents,
    private readonly intervalMs: number,
  ) {}

  url(): string {
    return this.contents.getURL()
  }

  evaluate<T>(expression: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The lab did not answer in time')), REQUEST_TIMEOUT_MS)
    })
    const evaluation = this.contents.executeJavaScript(expression, true) as Promise<T>
    return Promise.race([evaluation, timeout]).finally(() => clearTimeout(timer))
  }

  fetchText(url: string, init?: FetchInit): Promise<FetchedText> {
    return this.request(url, init, '({ status: r.status, url: r.url, text: await r.text() })')
  }

  readStorage<K extends string>(keys: readonly K[]): Promise<Record<K, string | null>> {
    return this.evaluate(readStorageScript(keys))
  }

  async writeStorage(entries: Readonly<Record<string, string | null>>): Promise<void> {
    await this.evaluate(writeStorageScript(entries))
  }

  async fetchBytes(url: string, init?: FetchInit): Promise<FetchedBytes> {
    // Bytes cross into the main process as base64, built in slices: one huge argument list overflows.
    const { base64, ...response } = await this.request<{ status: number; url: string; base64: string }>(
      url,
      init,
      `(() => { const b = new Uint8Array(await r.arrayBuffer()); let s = ""; ` +
        `for (let i = 0; i < b.length; i += ${BASE64_SLICE}) s += String.fromCharCode.apply(null, b.subarray(i, i + ${BASE64_SLICE})); ` +
        'return { status: r.status, url: r.url, base64: btoa(s) }; })()',
    )
    return { ...response, bytes: new Uint8Array(Buffer.from(base64, 'base64')) }
  }

  /** One request from inside the page, after the connector's pause; `read` turns the response `r` into T. */
  private async request<T>(url: string, init: FetchInit | undefined, read: string): Promise<T> {
    const wait = this.nextRequestAt - Date.now()
    if (wait > 0) await sleep(wait)
    const options = {
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      ...(init?.body === undefined ? {} : { body: init.body }),
      credentials: init?.credentials ?? 'include',
    }
    try {
      return await this.evaluate<T>(
        `fetch(${JSON.stringify(url)}, ${JSON.stringify(options)}).then(async (r) => ${read})`,
      )
    } finally {
      this.nextRequestAt = Date.now() + this.intervalMs
    }
  }
}

export type LoginOutcome = 'logged-in' | 'closed'

/** Where a lab's personal account is shown and used; every account keeps its own session. */
export interface LabSessions {
  /** Opens the account out of sight, runs `task` in its page and closes it. */
  withPage<T>(connector: LabConnector, partition: string, task: (page: LabPage) => Promise<T>): Promise<T>
  /**
   * Shows the lab's site for the person to log in. Closes by itself once `loggedIn` says someone
   * has, or ends when the person closes it.
   */
  showLogin(
    connector: LabConnector,
    partition: string,
    title: string,
    loggedIn: (page: LabPage) => Promise<boolean>,
  ): Promise<LoginOutcome>
  /** Forgets everything kept for an account: cookies, storage, cache. */
  forget(partition: string): Promise<void>
}

/**
 * The embedded browser. Each account lives in its own persistent partition, so several accounts
 * of one lab stay logged in side by side. Pages may not leave the lab's hosts, ask for
 * permissions or download files; links elsewhere open in the system browser.
 */
export class LabBrowser implements LabSessions {
  private readonly prepared = new Set<string>()

  constructor(private readonly parent: () => BrowserWindow | null) {}

  showLogin(
    connector: LabConnector,
    partition: string,
    title: string,
    loggedIn: (page: LabPage) => Promise<boolean>,
  ): Promise<LoginOutcome> {
    this.prepare(partition)
    const parent = this.parent()
    const window = new BrowserWindow({
      ...LOGIN_WINDOW,
      ...(parent ? { parent } : {}),
      title,
      autoHideMenuBar: true,
      webPreferences: labPagePreferences(partition),
    })
    this.guard(window.webContents, connector)
    window.on('page-title-updated', (event) => event.preventDefault())
    const page = new WebContentsLabPage(window.webContents, connector.requestIntervalMs)

    return new Promise((resolve) => {
      let checking = false
      let outcome: LoginOutcome | null = null
      const finish = (result: LoginOutcome) => {
        if (outcome) return
        outcome = result
        clearInterval(timer)
        resolve(result)
      }
      const check = async () => {
        if (checking || outcome || window.isDestroyed()) return
        checking = true
        try {
          if (await loggedIn(page)) {
            finish('logged-in')
            window.close()
          }
        } catch {
          // The page is between navigations or the person is still logging in: ask again later.
        } finally {
          checking = false
        }
      }
      const timer = setInterval(() => void check(), LOGIN_CHECK_INTERVAL_MS)
      window.webContents.on('did-navigate', () => void check())
      window.webContents.on('did-navigate-in-page', () => void check())
      window.once('closed', () => finish('closed'))
      void window.loadURL(connector.homeUrl).catch(ignoreAborted)
    })
  }

  async withPage<T>(
    connector: LabConnector,
    partition: string,
    task: (page: LabPage) => Promise<T>,
  ): Promise<T> {
    this.prepare(partition)
    const window = new BrowserWindow({ show: false, webPreferences: labPagePreferences(partition) })
    this.guard(window.webContents, connector)
    try {
      await window.loadURL(connector.syncUrl ?? connector.homeUrl).catch(ignoreAborted)
      return await task(new WebContentsLabPage(window.webContents, connector.requestIntervalMs))
    } finally {
      window.destroy()
    }
  }

  async forget(partition: string): Promise<void> {
    const ses = session.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
  }

  private prepare(partition: string): void {
    if (this.prepared.has(partition)) return
    this.prepared.add(partition)
    const ses = session.fromPartition(partition)
    ses.setUserAgent(browserUserAgent())
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.on('will-download', (event) => event.preventDefault())
  }

  private guard(contents: WebContents, connector: LabConnector): void {
    contents.setWindowOpenHandler(({ url }) => {
      if (isLabHost(url, connector.hosts)) void contents.loadURL(url).catch(ignoreAborted)
      else if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const keepOnLabHosts = (event: Event, url: string) => {
      if (!isLabHost(url, connector.hosts)) event.preventDefault()
    }
    contents.on('will-navigate', keepOnLabHosts)
    contents.on('will-redirect', keepOnLabHosts)
  }
}

function ignoreAborted(error: unknown): void {
  if ((error as { errno?: number }).errno !== ERR_ABORTED) throw error
}
