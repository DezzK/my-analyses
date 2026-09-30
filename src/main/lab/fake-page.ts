import type { FetchedBytes, FetchInit, FetchedText, LabPage } from './types'

const HTTP_OK = 200

/** What a route answers: text, or the bytes of a file. */
type Answer = { status: number; url: string; text?: string; bytes?: Uint8Array }
type Route = (url: string, init: FetchInit | undefined) => Answer | null

/** A LabPage for tests: answers expressions from a table and requests from routes, and logs them. */
export class FakeLabPage implements LabPage {
  readonly requests: { url: string; init: FetchInit | undefined }[] = []
  /** The page's localStorage. */
  readonly storage = new Map<string, string>()

  constructor(
    private readonly routes: Route[],
    private readonly expressions: Record<string, unknown> = {},
    private readonly pageUrl = 'https://lab.example/',
  ) {}

  url(): string {
    return this.pageUrl
  }

  async evaluate<T>(expression: string): Promise<T> {
    if (!(expression in this.expressions)) throw new Error(`Unexpected expression: ${expression}`)
    return this.expressions[expression] as T
  }

  async fetchText(url: string, init?: FetchInit): Promise<FetchedText> {
    const { status, url: final, text = '' } = this.route(url, init)
    return { status, url: final, text }
  }

  async fetchBytes(url: string, init?: FetchInit): Promise<FetchedBytes> {
    const { status, url: final, bytes = new Uint8Array(), text } = this.route(url, init)
    return { status, url: final, bytes: text === undefined ? bytes : new TextEncoder().encode(text) }
  }

  async readStorage<K extends string>(keys: readonly K[]): Promise<Record<K, string | null>> {
    return Object.fromEntries(keys.map((key) => [key, this.storage.get(key) ?? null])) as Record<
      K,
      string | null
    >
  }

  async writeStorage(entries: Readonly<Record<string, string>>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.storage.set(key, value)
  }

  private route(url: string, init: FetchInit | undefined): Answer {
    this.requests.push({ url, init })
    for (const route of this.routes) {
      const response = route(url, init)
      if (response) return response
    }
    return { status: 404, url }
  }
}

/** A route answering 200 with `text` for URLs containing `fragment`. */
export function answer(fragment: string, text: string | ((url: string, init?: FetchInit) => string)): Route {
  return (url, init) =>
    url.includes(fragment)
      ? { status: HTTP_OK, url, text: typeof text === 'string' ? text : text(url, init) }
      : null
}

/** A route answering 200 with a file for URLs containing `fragment`. */
export function answerBytes(fragment: string, bytes: Uint8Array): Route {
  return (url) => (url.includes(fragment) ? { status: HTTP_OK, url, bytes } : null)
}

/** A route answering `status` with no body for URLs containing `fragment`. */
export function refuse(fragment: string, status: number): Route {
  return (url) => (url.includes(fragment) ? { status, url } : null)
}
