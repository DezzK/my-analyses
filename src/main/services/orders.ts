import { desc, eq } from 'drizzle-orm'
import type { OrderDetails, OrderSummary, ResultRow } from '@shared/api'
import { isDeviation } from '@shared/domain/references'
import { UserError } from '@shared/errors'
import type { AttachmentStore } from '../attachments'
import type { Db } from '../db/client'
import { labOrder, result } from '../db/schema'
import type { ResultReader } from './results'

type OrderRow = typeof labOrder.$inferSelect

function summarize(order: OrderRow, results: readonly ResultRow[]): OrderSummary {
  return {
    id: order.id,
    labId: order.labId,
    collectedOn: order.collectedOn,
    collectedTime: order.collectedTime,
    source: order.source,
    note: order.note,
    hasForm: order.pdfFile !== null,
    resultCount: results.length,
    deviationCount: results.filter((r) => isDeviation(r.read.deviation)).length,
  }
}

/** Owner of orders: visits to a lab with the results they brought and the original form. */
export class OrderService {
  constructor(
    private readonly deps: {
      db: Db
      reader: ResultReader
      attachments: AttachmentStore
    },
  ) {}

  list(patientId: number): OrderSummary[] {
    const orders = this.deps.db
      .select()
      .from(labOrder)
      .where(eq(labOrder.patientId, patientId))
      .orderBy(desc(labOrder.collectedOn), desc(labOrder.collectedTime), desc(labOrder.id))
      .all()
    const byOrder = Map.groupBy(this.deps.reader.forPatient(patientId), (r) => r.orderId)
    return orders.map((order) => summarize(order, byOrder.get(order.id) ?? []))
  }

  get(orderId: number): OrderDetails {
    const order = this.find(orderId)
    const results = this.deps.reader.forPatient(order.patientId, eq(result.orderId, orderId))
    return { ...summarize(order, results), results }
  }

  /** Where the order's original form is stored. */
  formPath(orderId: number): string {
    const { pdfFile } = this.find(orderId)
    if (!pdfFile) throw new UserError('У этого заказа нет бланка')
    return this.deps.attachments.path(pdfFile)
  }

  private find(orderId: number): OrderRow {
    const row = this.deps.db.select().from(labOrder).where(eq(labOrder.id, orderId)).get()
    if (!row) throw new UserError('Заказ не найден')
    return row
  }
}
