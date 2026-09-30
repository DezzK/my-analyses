import { asc, count, eq, inArray } from 'drizzle-orm'
import { UserError } from '@shared/errors'
import type { AttachmentStore } from '../attachments'
import type { Db } from '../db/client'
import { orderForm } from '../db/schema'

/**
 * Owner of orders' original forms: which files an order has, in the order the lab lists them
 * (one per sample, say). The files themselves live in `AttachmentStore`.
 */
export class OrderForms {
  constructor(private readonly deps: { db: Db; attachments: AttachmentStore }) {}

  /** The stored names of an order's forms, first to last. */
  of(orderId: number): string[] {
    return this.deps.db
      .select({ file: orderForm.file })
      .from(orderForm)
      .where(eq(orderForm.orderId, orderId))
      .orderBy(asc(orderForm.position))
      .all()
      .map((row) => row.file)
  }

  /** How many forms each of the orders has; an order without any is absent. */
  counts(orderIds: readonly number[]): Map<number, number> {
    if (orderIds.length === 0) return new Map()
    const rows = this.deps.db
      .select({ orderId: orderForm.orderId, forms: count() })
      .from(orderForm)
      .where(inArray(orderForm.orderId, [...orderIds]))
      .groupBy(orderForm.orderId)
      .all()
    return new Map(rows.map((row) => [row.orderId, row.forms]))
  }

  /** Where the order's form number `index`, counted from 0, lies on disk. */
  path(orderId: number, index: number): string {
    const file = this.of(orderId)[index]
    if (!file) throw new UserError('У этого заказа нет такого бланка')
    return this.deps.attachments.path(file)
  }

  /** Stores PDF forms a lab sent and returns their names, in the same order. */
  storePdfs(forms: readonly Uint8Array[]): string[] {
    return forms.map((bytes) => this.deps.attachments.store(bytes, 'pdf'))
  }

  /** Makes `files`, names of stored forms, the order's forms in this order. */
  replace(orderId: number, files: readonly string[]): void {
    // `path` refuses a name that is not a stored form's.
    for (const file of files) this.deps.attachments.path(file)
    const { db } = this.deps
    db.delete(orderForm).where(eq(orderForm.orderId, orderId)).run()
    if (files.length === 0) return
    db.insert(orderForm)
      .values(files.map((file, position) => ({ orderId, position, file })))
      .run()
  }
}
