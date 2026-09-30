import type { LabFlag } from '@shared/domain/enums'

/** One result as the lab reported it; reading it is the importer's and the domain's job. */
export interface RawResult {
  /** The lab's own test code, unique within an order and stable across years. */
  labCode: string
  labName: string
  /** The lab's machine-readable value, when it gives one apart from the printed text. */
  value: string | null
  /** The value as printed: "5.40 ммоль/л", "<0.1", "отрицательно". */
  printed: string
  /** The reference range printed next to the result, if any. */
  reference: string | null
  flag: LabFlag | null
}

export interface RawOrder {
  /** Identifies the order within its lab across imports. */
  externalKey: string
  /** Collection date, `YYYY-MM-DD`, in the lab's own calendar. */
  collectedOn: string
  results: RawResult[]
  /** The lab's response exactly as received, kept so a connector fix can re-read it. */
  rawPayload: string
  /** The original form, when the lab gives one; stored as is, never parsed. */
  pdf: Uint8Array | null
}

/** What a connector needs to fetch one order's details later; its content is the connector's own. */
export interface OrderRef {
  externalKey: string
  collectedOn: string
  data: unknown
}

export interface LabAccountInfo {
  /** The lab's id of the account, when the pages reveal one. */
  externalId: string | null
  /** A human-readable name of the account, shown in the list of accounts. */
  label: string
}

export type BlockReason = 'vpn_or_region' | 'unknown'

export interface FetchInit {
  headers?: Record<string, string>
}

export interface FetchedText {
  status: number
  /** The final URL after redirects; a login page here means the session has expired. */
  url: string
  text: string
}

/** A lab's page open inside the app; requests made through it carry the page's own session. */
export interface LabPage {
  url(): string
  /** Runs a function inside the page and returns its JSON-serializable result. */
  evaluate<T>(fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<T>
  fetchText(url: string, init?: FetchInit): Promise<FetchedText>
  fetchJson<T>(url: string, init?: FetchInit): Promise<T>
}

/**
 * Knows one lab's personal account: how to tell a blocked or logged-out page, how to list the
 * orders and how to fetch each one as the lab reports it. Matching results to the catalog is not
 * a connector's job.
 */
export interface LabConnector {
  id: string
  version: string
  /** Where the person logs in, and where a sync starts. */
  homeUrl: string
  /** Hosts the account lives on; the embedded browser does not navigate anywhere else. */
  hosts: readonly string[]
  /** Pause between requests, so the site's protection is not tripped. */
  requestIntervalMs: number
  detectBlock(page: LabPage): Promise<BlockReason | null>
  /** Null when nobody is logged in. */
  detectAccount(page: LabPage): Promise<LabAccountInfo | null>
  listOrders(page: LabPage): Promise<OrderRef[]>
  fetchOrder(page: LabPage, ref: OrderRef): Promise<Omit<RawOrder, 'pdf'>>
  fetchOrderPdf?(page: LabPage, ref: OrderRef): Promise<Uint8Array | null>
}
