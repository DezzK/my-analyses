import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  ManualOrder,
  Patient,
  OrderDetails,
  OrderInput,
  OrderSummary,
  ResultInput,
  ResultRow,
  RowWarning,
} from '@shared/api'
import { cycleOn } from '@shared/domain/conditions'
import { CYCLE_PHASES, type CyclePhase } from '@shared/domain/enums'
import { formatDateRu } from '@shared/domain/dates'
import { isDeviation } from '@shared/domain/references'
import { parseValue } from '@shared/domain/values'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyteUnit, labOrder, result } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import type { AnalyteService } from './analytes'
import type { LabService } from './labs'
import type { OrderForms } from './order-forms'
import type { PatientService } from './patients'
import type { ResultReader } from './results'
import type { UnitService } from './units'
import { assertPastDate } from './validation'

type OrderRow = typeof labOrder.$inferSelect
type StoredResult = typeof result.$inferSelect

/** A typed value this many times off the previous one is most likely in another unit. */
const FAR_OFF_FACTOR = 10
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** An order collected before its patient was born cannot be theirs. */
function assertBornBy(patient: Patient, collectedOn: string): void {
  if (collectedOn < patient.birthDate) throw new UserError('Дата сдачи раньше даты рождения пациента')
}

function summarize(order: OrderRow, results: readonly ResultRow[], formCount: number): OrderSummary {
  return {
    id: order.id,
    labId: order.labId,
    collectedOn: order.collectedOn,
    collectedTime: order.collectedTime,
    source: order.source,
    note: order.note,
    formCount,
    resultCount: results.length,
    deviationCount: results.filter((r) => isDeviation(r.read.deviation)).length,
  }
}

/**
 * Owner of orders: visits to a lab with the results they brought and the original form, whether
 * imported or entered by hand, and the rules for entering and correcting them.
 */
export class OrderService {
  /** Deleted orders kept for their undo, by token; an undo window is seconds long. */
  private readonly removed = new Map<string, { order: OrderRow; results: StoredResult[]; forms: string[] }>()

  constructor(
    private readonly deps: {
      db: Db
      reader: ResultReader
      forms: OrderForms
      patients: PatientService
      analytes: AnalyteService
      units: UnitService
      labs: LabService
      events: EventSink
      today: () => string
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
    const forms = this.deps.forms.counts(orders.map((order) => order.id))
    return orders.map((order) => summarize(order, byOrder.get(order.id) ?? [], forms.get(order.id) ?? 0))
  }

  get(orderId: number): OrderDetails {
    const order = this.find(orderId)
    const results = this.deps.reader.forPatient(order.patientId, eq(result.orderId, orderId))
    const formFiles = this.deps.forms.of(orderId)
    return {
      ...summarize(order, results, formFiles.length),
      patientId: order.patientId,
      cyclePhase: order.cyclePhase,
      formFiles,
      results,
    }
  }

  /** An order entered by hand, with its results; import never touches it. */
  create(order: ManualOrder): number {
    const { formFiles, ...header } = this.validateHeader(order)
    const rows = this.validateRows(order.results)
    const id = inTransaction(this.deps.db, () => {
      const created = this.deps.db
        .insert(labOrder)
        .values({ ...header, source: 'manual' })
        .returning({ id: labOrder.id })
        .get().id
      this.deps.forms.replace(created, formFiles)
      for (const row of rows) {
        this.deps.db
          .insert(result)
          .values({ ...row, orderId: created })
          .run()
      }
      return created
    })
    dataChanged(this.deps.events, 'orders')
    return id
  }

  /** What in the typed results deserves a second look: a value ten times off the previous one. */
  check(order: ManualOrder): RowWarning[] {
    const { reader, units } = this.deps
    const typed = order.results.map((row) => ({ ...row, rawValue: row.rawValue.trim() }))
    const numeric = typed.flatMap((row, index) =>
      row.rawValue && parseValue(row.rawValue).kind === 'numeric' ? [{ row, index }] : [],
    )
    if (numeric.length === 0) return []
    const read = reader.preview(
      order.patientId,
      numeric.map(({ row }) => ({
        ...row,
        labFlag: null,
        labId: order.labId,
        collectedOn: order.collectedOn,
        cyclePhase: order.cyclePhase,
      })),
    )
    return numeric.flatMap(({ row, index }, i) => {
      const now = read[i]?.value
      if (!now?.number || !now.inTarget) return []
      const previous = reader
        .forPatient(order.patientId, eq(result.analyteId, row.analyteId))
        .find((stored) => stored.read.value.number && stored.read.value.inTarget)
      const before = previous?.read.value.number
      if (!previous || !before || before.value <= 0 || now.number.value <= 0) return []
      const ratio = Math.max(before.value, now.number.value) / Math.min(before.value, now.number.value)
      if (ratio < FAR_OFF_FACTOR) return []
      const unit = now.unitId === null ? '' : ` ${units.get(now.unitId)?.display ?? ''}`
      return [
        {
          row: index,
          message: `В ${Math.round(ratio)} раз отличается от прошлого значения (${before.text}${unit} от ${formatDateRu(previous.collectedOn)}) — проверьте единицу`,
        },
      ]
    })
  }

  update(orderId: number, header: OrderInput): void {
    this.find(orderId)
    const { formFiles, ...values } = this.validateHeader(header)
    inTransaction(this.deps.db, () => {
      this.deps.db
        .update(labOrder)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(labOrder.id, orderId))
        .run()
      this.deps.forms.replace(orderId, formFiles)
    })
    dataChanged(this.deps.events, 'orders')
  }

  /** Records the cycle phase the sample was collected in; only a woman outside pregnancy has one. */
  setCyclePhase(orderId: number, phase: CyclePhase | null): void {
    const order = this.find(orderId)
    this.checkPhase(order.patientId, order.collectedOn, phase)
    this.deps.db.update(labOrder).set({ cyclePhase: phase }).where(eq(labOrder.id, orderId)).run()
    dataChanged(this.deps.events, 'orders')
  }

  /** The orders imported for a lab's person. */
  ofLabPerson(labPersonId: number): number[] {
    return this.deps.db
      .select({ id: labOrder.id })
      .from(labOrder)
      .where(eq(labOrder.labPersonId, labPersonId))
      .all()
      .map((row) => row.id)
  }

  /**
   * Gives orders to another patient, as when the lab's person they came for turns out to be
   * someone else. A cycle phase that patient cannot have had is dropped.
   */
  moveToPatient(orderIds: readonly number[], patientId: number): void {
    const patient = this.deps.patients.get(patientId)
    const orders = orderIds.map((id) => this.find(id))
    for (const order of orders) assertBornBy(patient, order.collectedOn)
    inTransaction(this.deps.db, () => {
      for (const order of orders) {
        const keepsPhase =
          order.cyclePhase !== null && this.phaseProblem(patientId, order.collectedOn) === null
        this.deps.db
          .update(labOrder)
          .set({
            patientId,
            cyclePhase: keepsPhase ? order.cyclePhase : null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(labOrder.id, order.id))
          .run()
      }
    })
    if (orders.length > 0) dataChanged(this.deps.events, 'orders')
  }

  /** Deletes orders and their results for good, with no undo: nobody here wants them. */
  purge(orderIds: readonly number[]): void {
    if (orderIds.length === 0) return
    this.deps.db
      .delete(labOrder)
      .where(inArray(labOrder.id, [...orderIds]))
      .run()
    dataChanged(this.deps.events, 'orders')
  }

  /** Deletes an order and its results; the token brings them back while the undo is offered. */
  remove(orderId: number): string {
    const order = this.find(orderId)
    const results = this.deps.db.select().from(result).where(eq(result.orderId, orderId)).all()
    const forms = this.deps.forms.of(orderId)
    this.deps.db.delete(labOrder).where(eq(labOrder.id, orderId)).run()
    const token = randomUUID()
    this.removed.set(token, { order, results, forms })
    dataChanged(this.deps.events, 'orders')
    return token
  }

  undoRemove(token: string): void {
    const snapshot = this.removed.get(token)
    if (!snapshot) throw new UserError('Удалённый заказ уже не вернуть')
    inTransaction(this.deps.db, () => {
      this.deps.db.insert(labOrder).values(snapshot.order).run()
      for (const row of snapshot.results) this.deps.db.insert(result).values(row).run()
      this.deps.forms.replace(snapshot.order.id, snapshot.forms)
    })
    this.removed.delete(token)
    dataChanged(this.deps.events, 'orders')
  }

  addResult(orderId: number, input: ResultInput): void {
    this.find(orderId)
    const [row] = this.validateRows([input], this.analytesIn(orderId))
    if (!row) return
    this.deps.db
      .insert(result)
      .values({ ...row, orderId })
      .run()
    dataChanged(this.deps.events, 'orders')
  }

  /** Corrects a result; one that came from a lab stays as corrected when the lab sends it again. */
  updateResult(resultId: number, input: ResultInput): void {
    const current = this.findResult(resultId)
    const others = this.analytesIn(current.orderId).filter((id) => id !== current.analyteId)
    const [row] = this.validateRows([input], others)
    if (!row) return
    this.deps.db
      .update(result)
      .set({ ...row, userEdited: current.externalKey !== null })
      .where(eq(result.id, resultId))
      .run()
    dataChanged(this.deps.events, 'orders')
  }

  removeResult(resultId: number): void {
    this.findResult(resultId)
    this.deps.db.delete(result).where(eq(result.id, resultId)).run()
    dataChanged(this.deps.events, 'orders')
  }

  /** Where the order's original form number `index`, from 0, is stored. */
  formPath(orderId: number, index: number): string {
    this.find(orderId)
    return this.deps.forms.path(orderId, index)
  }

  private find(orderId: number): OrderRow {
    const row = this.deps.db.select().from(labOrder).where(eq(labOrder.id, orderId)).get()
    if (!row) throw new UserError('Заказ не найден')
    return row
  }

  private findResult(resultId: number): StoredResult {
    const row = this.deps.db.select().from(result).where(eq(result.id, resultId)).get()
    if (!row) throw new UserError('Результат не найден')
    return row
  }

  private analytesIn(orderId: number): number[] {
    return this.deps.db
      .select({ id: result.analyteId })
      .from(result)
      .where(eq(result.orderId, orderId))
      .all()
      .map((r) => r.id)
  }

  private checkPhase(patientId: number, collectedOn: string, phase: CyclePhase | null): void {
    if (phase === null) return
    if (!CYCLE_PHASES.includes(phase)) throw new UserError('Неизвестная фаза цикла')
    const problem = this.phaseProblem(patientId, collectedOn)
    if (problem) throw new UserError(problem)
  }

  /** Why the patient had no cycle phase that day: only a woman has one, and not while pregnant or after menopause. */
  private phaseProblem(patientId: number, collectedOn: string): string | null {
    if (this.deps.patients.get(patientId).sex !== 'female') return 'Фаза цикла бывает только у женщин'
    if (!cycleOn(collectedOn, this.deps.patients.periods(patientId))) {
      return 'В день сдачи шла беременность или менопауза: фазы цикла не было'
    }
    return null
  }

  private validateHeader(input: OrderInput): OrderInput {
    const patient = this.deps.patients.get(input.patientId)
    if (!this.deps.labs.get(input.labId)) throw new UserError('Выберите лабораторию')
    assertPastDate(input.collectedOn, 'дата сдачи', this.deps.today())
    assertBornBy(patient, input.collectedOn)
    const collectedTime = input.collectedTime?.trim() || null
    if (collectedTime !== null && !TIME.test(collectedTime)) throw new UserError('Время сдачи — в виде ЧЧ:ММ')
    this.checkPhase(input.patientId, input.collectedOn, input.cyclePhase)
    return { ...input, collectedTime, note: input.note?.trim() || null }
  }

  /**
   * Results as typed: each of an analyte the order does not have yet, with a value, and in one of
   * the analyte's units. Messages name the row when there are several.
   */
  private validateRows(inputs: readonly ResultInput[], taken: readonly number[] = []) {
    if (inputs.length === 0) throw new UserError('Добавьте хотя бы один результат')
    const seen = new Set(taken)
    return inputs.map((input, index) => {
      const where = inputs.length > 1 ? `Строка ${index + 1}: ` : ''
      const analyte = this.deps.analytes.find(input.analyteId)
      if (seen.has(analyte.id)) throw new UserError(`${where}«${analyte.name}» уже есть в этом заказе`)
      seen.add(analyte.id)
      const rawValue = input.rawValue.trim()
      if (!rawValue) throw new UserError(`${where}введите значение «${analyte.name}»`)
      if (input.unitId !== null) {
        const allowed = this.deps.db
          .select()
          .from(analyteUnit)
          .where(and(eq(analyteUnit.analyteId, analyte.id), eq(analyteUnit.unitId, input.unitId)))
          .get()
        if (!allowed) {
          throw new UserError(
            `${where}эта единица не относится к «${analyte.name}» — добавьте её в справочнике`,
          )
        }
      } else if (analyte.canonicalUnitId !== null && parseValue(rawValue).kind === 'numeric') {
        throw new UserError(`${where}укажите единицу «${analyte.name}»`)
      }
      return {
        analyteId: analyte.id,
        rawValue,
        unitId: input.unitId,
        refRaw: input.refRaw?.trim() || null,
        note: input.note?.trim() || null,
      }
    })
  }
}
