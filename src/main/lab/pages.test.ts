import { describe, expect, it } from 'vitest'
import { STRAY_PDF_PREFIX } from './fake-page'
import { isPdf } from './pages'

const encode = (text: string) => new TextEncoder().encode(text)

describe('isPdf', () => {
  it('knows a PDF by its header, where PDF readers look for it', () => {
    expect(isPdf(encode('%PDF-1.7\n…'))).toBe(true)
    // Some generators write a stray line first; readers look a kilobyte in.
    expect(isPdf(encode(`${STRAY_PDF_PREFIX}%PDF-1.4\n…`))).toBe(true)
    expect(isPdf(encode(`${' '.repeat(1024)}%PDF-1.4`))).toBe(false)
  })

  it('takes an error page served in its place for what it is', () => {
    expect(isPdf(encode('<!doctype html><title>Ошибка</title>'))).toBe(false)
    expect(isPdf(new Uint8Array())).toBe(false)
  })
})
