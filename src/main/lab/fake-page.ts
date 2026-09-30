import type { FetchInit, FetchedText, LabPage } from './types'

type Route = (url: string, init: FetchInit | undefined) => FetchedText | null

/** A LabPage for tests: answers expressions from a table and requests from routes, and logs them. */
export class FakeLabPage implements LabPage {
  readonly requests: { url: string; init: FetchInit | undefined }[] = []

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
    this.requests.push({ url, init })
    for (const route of this.routes) {
      const response = route(url, init)
      if (response) return response
    }
    return { status: 404, url, text: '' }
  }
}

/** A route answering 200 with `text` for URLs containing `fragment`. */
export function answer(fragment: string, text: string | ((url: string) => string)): Route {
  return (url) =>
    url.includes(fragment) ? { status: 200, url, text: typeof text === 'string' ? text : text(url) } : null
}
