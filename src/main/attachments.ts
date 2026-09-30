import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

/** What an original lab form comes as: the lab's own PDF, or a photo of a paper form. */
export const FORM_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp'] as const
export type FormExtension = (typeof FORM_EXTENSIONS)[number]

const KEY = new RegExp(`^[0-9a-f]{64}\\.(?:${FORM_EXTENSIONS.join('|')})$`)

/** The form extension of a picked file's name, or null when a form cannot be such a file. */
export function formExtensionOf(fileName: string): FormExtension | null {
  const extension = extname(fileName).slice(1).toLowerCase()
  return FORM_EXTENSIONS.find((e) => e === extension) ?? null
}

/**
 * Original lab forms, stored once each under the SHA-256 of their bytes: the same file stored
 * twice is one file, and a file never changes once written, which lets backups copy only new ones.
 */
export class AttachmentStore {
  constructor(private readonly dir: string) {}

  /** Stores the bytes (unless already there) and returns the file's name, the attachment's key. */
  store(bytes: Uint8Array, extension: FormExtension): string {
    const key = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
    const file = this.path(key)
    if (!existsSync(file)) {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(file, bytes)
    }
    return key
  }

  path(key: string): string {
    if (!KEY.test(key)) throw new Error(`Not an attachment key: ${key}`)
    return join(this.dir, key)
  }
}
