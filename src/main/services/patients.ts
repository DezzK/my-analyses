import { and, count, eq, getColumns, isNotNull, isNull, ne } from 'drizzle-orm'
import type { Patient, PatientInput, PatientPeriod, PatientPeriodInput } from '@shared/api'
import { epochDay, todayIso } from '@shared/domain/dates'
import { PERIOD_KINDS, SEXES } from '@shared/domain/enums'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { labOrder, patient, patientPeriod } from '../db/schema'
import { dataChanged, type EventSink } from '../events'
import { assertPastDate, typedName } from './validation'
const EARLIEST_BIRTH_DATE = '1900-01-01'
/** Stands in for the end of a period that is still going on; sorts after any real date. */
const OPEN_END = '9999-12-31'

const { deletedAt: _deletedAt, ...patientColumns } = getColumns(patient)

/** Owner of patients and their periods: every rule about them is checked here and only here. */
export class PatientService {
  constructor(
    private readonly db: Db,
    private readonly events: EventSink,
    private readonly today: () => string = todayIso,
  ) {}

  list(): Patient[] {
    return this.db
      .select(patientColumns)
      .from(patient)
      .where(isNull(patient.deletedAt))
      .orderBy(patient.title)
      .all()
  }

  get(id: number): Patient {
    const row = this.db
      .select(patientColumns)
      .from(patient)
      .where(and(eq(patient.id, id), isNull(patient.deletedAt)))
      .get()
    if (!row) throw new UserError('Пациент не найден')
    return row
  }

  create(input: PatientInput): Patient {
    const values = this.validate(input)
    const row = this.db.insert(patient).values(values).returning(patientColumns).get()
    dataChanged(this.events, 'patients')
    return row
  }

  update(id: number, input: PatientInput): Patient {
    const values = this.validate(input)
    const current = this.get(id)
    if (current.sex !== values.sex && values.sex !== 'female' && this.periods(id).length > 0) {
      throw new UserError('Сначала удалите периоды беременности и менопаузы: они бывают только у пациенток')
    }
    const row = this.db.update(patient).set(values).where(eq(patient.id, id)).returning(patientColumns).get()
    if (!row) throw new UserError('Пациент не найден')
    dataChanged(this.events, 'patients')
    return row
  }

  remove(id: number): void {
    this.get(id)
    this.db.update(patient).set({ deletedAt: new Date().toISOString() }).where(eq(patient.id, id)).run()
    dataChanged(this.events, 'patients')
  }

  restore(id: number): void {
    this.db.update(patient).set({ deletedAt: null }).where(eq(patient.id, id)).run()
    dataChanged(this.events, 'patients')
  }

  /** Deletes for good the patients removed before this start; their orders go with them. */
  purgeRemoved(): void {
    this.db.delete(patient).where(isNotNull(patient.deletedAt)).run()
  }

  orderCount(id: number): number {
    const row = this.db.select({ n: count() }).from(labOrder).where(eq(labOrder.patientId, id)).get()
    return row?.n ?? 0
  }

  periods(patientId: number): PatientPeriod[] {
    return this.db
      .select()
      .from(patientPeriod)
      .where(eq(patientPeriod.patientId, patientId))
      .orderBy(patientPeriod.startDate)
      .all()
  }

  addPeriod(patientId: number, input: PatientPeriodInput): PatientPeriod {
    const values = this.validatePeriod(patientId, input, null)
    const row = this.db
      .insert(patientPeriod)
      .values({ ...values, patientId })
      .returning()
      .get()
    dataChanged(this.events, 'periods')
    return row
  }

  updatePeriod(id: number, input: PatientPeriodInput): PatientPeriod {
    const existing = this.db.select().from(patientPeriod).where(eq(patientPeriod.id, id)).get()
    if (!existing) throw new UserError('Период не найден')
    const values = this.validatePeriod(existing.patientId, input, id)
    const row = this.db.update(patientPeriod).set(values).where(eq(patientPeriod.id, id)).returning().get()
    if (!row) throw new UserError('Период не найден')
    dataChanged(this.events, 'periods')
    return row
  }

  removePeriod(id: number): void {
    this.db.delete(patientPeriod).where(eq(patientPeriod.id, id)).run()
    dataChanged(this.events, 'periods')
  }

  private validate(input: PatientInput): PatientInput {
    const title = typedName(input.title, 'Укажите имя пациента', { noun: 'Имя' })
    if (!SEXES.includes(input.sex)) throw new UserError('Укажите пол пациента')
    this.assertPastDate(input.birthDate, 'дата рождения')
    if (input.birthDate < EARLIEST_BIRTH_DATE) throw new UserError('Проверьте дату рождения')
    const note = input.note?.trim() || null
    return { title, sex: input.sex, birthDate: input.birthDate, note }
  }

  private validatePeriod(
    patientId: number,
    input: PatientPeriodInput,
    selfId: number | null,
  ): PatientPeriodInput {
    const owner = this.get(patientId)
    if (owner.sex !== 'female')
      throw new UserError('Периоды беременности и менопаузы бывают только у пациенток')
    if (!PERIOD_KINDS.includes(input.kind)) throw new UserError('Неизвестный вид периода')
    this.assertPastDate(input.startDate, 'дата начала')
    if (input.startDate < owner.birthDate) throw new UserError('Период не может начаться раньше рождения')
    const endDate = input.endDate || null
    if (input.kind === 'menopause' && endDate) throw new UserError('У менопаузы нет даты окончания')
    if (endDate) {
      if (epochDay(endDate) === null) throw new UserError('Проверьте дату окончания')
      if (endDate < input.startDate) throw new UserError('Период заканчивается раньше, чем начинается')
    }
    const others = this.db
      .select()
      .from(patientPeriod)
      .where(
        and(
          eq(patientPeriod.patientId, patientId),
          eq(patientPeriod.kind, input.kind),
          selfId === null ? undefined : ne(patientPeriod.id, selfId),
        ),
      )
      .all()
    if (input.kind === 'menopause' && others.length > 0) throw new UserError('Менопауза уже указана')
    const overlaps = others.some(
      (o) => input.startDate <= (o.endDate ?? OPEN_END) && o.startDate <= (endDate ?? OPEN_END),
    )
    if (overlaps) throw new UserError('Периоды беременности не могут пересекаться')
    return { kind: input.kind, startDate: input.startDate, endDate }
  }

  private assertPastDate(value: string, what: string): void {
    assertPastDate(value, what, this.today())
  }
}
