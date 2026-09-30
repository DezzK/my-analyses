import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PDF_EXTENSION = '.pdf'

/**
 * Original lab forms, stored once each under the SHA-256 of their bytes: the same PDF imported
 * twice is one file, and a file never changes once written, which lets backups copy only new ones.
 */
export class AttachmentStore {
  constructor(private readonly dir: string) {}

  /** Stores the bytes (unless already there) and returns their hash, the attachment's key. */
  store(bytes: Uint8Array): string {
    const hash = createHash('sha256').update(bytes).digest('hex')
    const file = this.path(hash)
    if (!existsSync(file)) {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(file, bytes)
    }
    return hash
  }

  path(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Not an attachment key: ${hash}`)
    return join(this.dir, `${hash}${PDF_EXTENSION}`)
  }
}
