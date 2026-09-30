import type { BlockReason, LabPage } from './types'

/** The page's text as the block detectors read it: a lab's refusal is short and near the top. */
export const PAGE_TEXT_EXPRESSION = 'document.body ? document.body.innerText.slice(0, 2000) : ""'

/**
 * Russian labs refuse VPN and foreign connections with a page of their own: a "Forbidden" title,
 * or text that names the VPN. The same test serves every lab until one answers differently.
 */
export async function detectVpnBlock(page: LabPage): Promise<BlockReason | null> {
  const title = await page.evaluate<string>('document.title')
  const text = await page.evaluate<string>(PAGE_TEXT_EXPRESSION)
  return title === 'Forbidden' || /VPN/i.test(text) ? 'vpn_or_region' : null
}

const PDF_SIGNATURE = '%PDF-'

/** Whether bytes a lab sent as a form are a PDF, rather than an error page served in its place. */
export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length)) === PDF_SIGNATURE
}
