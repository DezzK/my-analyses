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
  /**
   * The original forms, as many as the lab issues (one per sample, say), stored as they are and
   * never parsed. Empty when none were fetched this time: the forms stored before stay.
   */
  forms: Uint8Array[]
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
  /**
   * A human-readable name of the account, shown in the list of accounts; null when the pages name
   * nobody, and the account keeps the label it has.
   */
  label: string | null
}

export type BlockReason = 'vpn_or_region' | 'unknown'

export interface FetchInit {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** Sent as is: a JSON body goes with its own `Content-Type` header. */
  body?: string
  /**
   * The page's cookies go with every request unless `omit`: an API on another host that trusts
   * only its token refuses a request that carries them.
   */
  credentials?: 'include' | 'omit'
}

export interface FetchedText {
  status: number
  /** The final URL after redirects; a login page here means the session has expired. */
  url: string
  text: string
}

export interface FetchedBytes {
  status: number
  url: string
  bytes: Uint8Array
}

/** A lab's page open inside the app; requests made through it carry the page's own session. */
export interface LabPage {
  url(): string
  /**
   * Evaluates a JavaScript expression inside the page (`document.title`) and returns its
   * JSON-serializable value. An expression, not a function: bundled code does not survive
   * `Function.prototype.toString` reliably.
   */
  evaluate<T>(expression: string): Promise<T>
  /** Requests go one at a time, spaced by the connector's `requestIntervalMs`. */
  fetchText(url: string, init?: FetchInit): Promise<FetchedText>
  /** The same, for a file such as a PDF form. */
  fetchBytes(url: string, init?: FetchInit): Promise<FetchedBytes>
  /** The page's localStorage entries under `keys`; a missing one reads as null. */
  readStorage<K extends string>(keys: readonly K[]): Promise<Record<K, string | null>>
  /** Stores entries in the page's localStorage, where the lab's own site looks for them. */
  writeStorage(entries: Readonly<Record<string, string>>): Promise<void>
}

const FIRST_ERROR_STATUS = 400
const HTTP_UNAUTHORIZED = 401

/** Whether the lab refused or failed the request. */
export function isErrorStatus(status: number): boolean {
  return status >= FIRST_ERROR_STATUS
}

/** A request the lab answered with an error status. */
export class LabHttpError extends Error {
  override readonly name = 'LabHttpError'

  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`)
  }

  /** Whether `error` is the lab answering a request with `status`. */
  static isStatus(error: unknown, status: number): boolean {
    return error instanceof LabHttpError && error.status === status
  }

  /** What a request meets once the session is over, even when the page finds out before sending it. */
  static sessionEnded(url: string): LabHttpError {
    return new LabHttpError(HTTP_UNAUTHORIZED, url)
  }

  /** The lab no longer recognizes the session: the person has to log in again. */
  get sessionExpired(): boolean {
    return this.status === HTTP_UNAUTHORIZED
  }
}

/** Fetches through the page; an error status becomes a `LabHttpError`. */
export async function fetchOk(page: LabPage, url: string, init?: FetchInit): Promise<FetchedText> {
  return refuseErrors(await page.fetchText(url, init))
}

/** Fetches a file through the page; an error status becomes a `LabHttpError`. */
export async function fetchBytesOk(page: LabPage, url: string, init?: FetchInit): Promise<FetchedBytes> {
  return refuseErrors(await page.fetchBytes(url, init))
}

function refuseErrors<T extends { status: number; url: string }>(response: T): T {
  if (isErrorStatus(response.status)) throw new LabHttpError(response.status, response.url)
  return response
}

/**
 * Knows one lab's personal account: how to tell a blocked or logged-out page, how to list the
 * orders and how to fetch each one as the lab reports it. Matching results to the catalog is not
 * a connector's job.
 */
export interface LabConnector {
  id: string
  version: string
  /** Where the person logs in, and where a sync starts unless `syncUrl` says otherwise. */
  homeUrl: string
  /**
   * Where a sync opens the account instead: a page of the lab's origin that runs none of the
   * site's own code, for a site that would otherwise refresh the session behind the connector.
   */
  syncUrl?: string
  /** Hosts the account lives on; the embedded browser does not navigate anywhere else. */
  hosts: readonly string[]
  /** Pause between requests, so the site's protection is not tripped. */
  requestIntervalMs: number
  detectBlock(page: LabPage): Promise<BlockReason | null>
  /** Null when nobody is logged in. */
  detectAccount(page: LabPage): Promise<LabAccountInfo | null>
  /**
   * Whether someone has logged in, asked of the login window while the site itself runs there.
   * Only a connector whose `detectAccount` would disturb that site's session needs its own.
   */
  detectLogin?(page: LabPage): Promise<boolean>
  listOrders(page: LabPage): Promise<OrderRef[]>
  fetchOrder(page: LabPage, ref: OrderRef): Promise<Omit<RawOrder, 'forms'>>
  /** The order's original forms; empty when the lab has issued none yet. */
  fetchOrderForms?(page: LabPage, ref: OrderRef): Promise<Uint8Array[]>
}
