import { and, asc, count, desc, eq, isNotNull, max } from 'drizzle-orm'
import type { LabReference, ReferenceRule, RuleInput } from '@shared/api'
import { REFERENCE_CONDITIONS, SEXES } from '@shared/domain/enums'
import { parseReference } from '@shared/domain/references'
import { asQualitativeCode, QUALITATIVE_CODES } from '@shared/domain/values'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyteUnit, labOrder, referenceRule, result } from '../db/schema'
import { dataChanged, type EventSink } from '../events'
import type { UnitService } from './units'

type RuleRow = typeof referenceRule.$inferSelect

function toRule({ createdAt: _, expected, ...row }: RuleRow): ReferenceRule {
  return { ...row, expected: asQualitativeCode(expected) }
}

/** Two half-open age ranges [from, to) in days share a day; a missing limit is open. */
function agesOverlap(a: RuleInput, b: RuleInput): boolean {
  const from = Math.max(a.ageFromDays ?? 0, b.ageFromDays ?? 0)
  const to = Math.min(a.ageToDays ?? Number.POSITIVE_INFINITY, b.ageToDays ?? Number.POSITIVE_INFINITY)
  return from < to
}

/**
 * Owner of reference rules: the norms of the catalog, general or one lab's exception, by sex, age
 * and condition. Which rule applies to a result is `chooseRule`'s answer; this keeps the rules
 * consistent enough for that answer to be unique.
 */
export class RuleService {
  constructor(
    private readonly deps: {
      db: Db
      units: UnitService
      events: EventSink
    },
  ) {}

  list(analyteId: number): ReferenceRule[] {
    return this.deps.db
      .select()
      .from(referenceRule)
      .where(eq(referenceRule.analyteId, analyteId))
      .orderBy(asc(referenceRule.labId), asc(referenceRule.ageFromDays), asc(referenceRule.id))
      .all()
      .map(toRule)
  }

  create(analyteId: number, input: RuleInput): ReferenceRule {
    const values = this.validate(analyteId, input, null)
    const row = this.deps.db
      .insert(referenceRule)
      .values({ ...values, analyteId })
      .returning()
      .get()
    dataChanged(this.deps.events, 'catalog')
    return toRule(row)
  }

  update(ruleId: number, input: RuleInput): ReferenceRule {
    const current = this.find(ruleId)
    const values = this.validate(current.analyteId, input, ruleId)
    const row = this.deps.db
      .update(referenceRule)
      .set(values)
      .where(eq(referenceRule.id, ruleId))
      .returning()
      .get()
    dataChanged(this.deps.events, 'catalog')
    return toRule(row ?? current)
  }

  remove(ruleId: number): void {
    this.find(ruleId)
    this.deps.db.delete(referenceRule).where(eq(referenceRule.id, ruleId)).run()
    dataChanged(this.deps.events, 'catalog')
  }

  /**
   * The references labs printed next to the analyte's results, newest first, read into bounds:
   * a lab's rule starts from one of them in a click.
   */
  labReferences(analyteId: number): LabReference[] {
    const last = max(labOrder.collectedOn)
    const rows = this.deps.db
      .select({
        labId: labOrder.labId,
        text: result.refRaw,
        unitId: result.unitId,
        count: count(),
        lastCollectedOn: last,
      })
      .from(result)
      .innerJoin(labOrder, eq(labOrder.id, result.orderId))
      .where(and(eq(result.analyteId, analyteId), isNotNull(result.refRaw)))
      .groupBy(labOrder.labId, result.refRaw, result.unitId)
      .orderBy(desc(last))
      .all()
    return rows.flatMap((row): LabReference[] => {
      const parsed = parseReference(row.text)
      if (!parsed || !row.text || !row.lastCollectedOn) return []
      const base = {
        labId: row.labId,
        text: row.text,
        count: row.count,
        lastCollectedOn: row.lastCollectedOn,
      }
      if (parsed.kind === 'qualitative') {
        return [{ ...base, low: null, high: null, expected: parsed.expected, unitId: null }]
      }
      const unitId =
        parsed.unitText === null ? row.unitId : (this.deps.units.resolve(parsed.unitText)?.id ?? null)
      return [
        { ...base, low: parsed.low?.value ?? null, high: parsed.high?.value ?? null, expected: null, unitId },
      ]
    })
  }

  private find(ruleId: number): RuleRow {
    const row = this.deps.db.select().from(referenceRule).where(eq(referenceRule.id, ruleId)).get()
    if (!row) throw new UserError('Правило не найдено')
    return row
  }

  private validate(analyteId: number, input: RuleInput, exceptId: number | null): RuleInput {
    const { low, high, expected, sex, condition, ageFromDays, ageToDays } = input
    const bounded = low !== null || high !== null
    if (expected !== null && !QUALITATIVE_CODES.includes(expected)) throw new UserError('Неизвестный ответ')
    if (!bounded && expected === null) throw new UserError('Укажите границы нормы или ожидаемый ответ')
    if (bounded && expected !== null) throw new UserError('Правило задаёт либо границы, либо ожидаемый ответ')
    if (low !== null && high !== null && low > high) throw new UserError('Нижняя граница больше верхней')
    if (sex !== null && !SEXES.includes(sex)) throw new UserError('Неизвестный пол')
    if (condition !== null && !REFERENCE_CONDITIONS.includes(condition))
      throw new UserError('Неизвестное условие')
    // Every condition a rule can have (pregnancy, cycle phase, postmenopause) is a woman's.
    if (condition !== null && sex === 'male') {
      throw new UserError('Беременность, фаза цикла и постменопауза бывают только у женщин')
    }
    if ((ageFromDays !== null && ageFromDays < 0) || (ageToDays !== null && ageToDays <= 0)) {
      throw new UserError('Возраст не может быть отрицательным')
    }
    if (ageFromDays !== null && ageToDays !== null && ageFromDays >= ageToDays) {
      throw new UserError('Возраст «от» должен быть меньше возраста «до»')
    }

    const unitId = bounded ? input.unitId : null
    if (bounded) {
      if (unitId === null) throw new UserError('Укажите единицу, в которой записаны границы')
      const allowed = this.deps.db
        .select()
        .from(analyteUnit)
        .where(and(eq(analyteUnit.analyteId, analyteId), eq(analyteUnit.unitId, unitId)))
        .get()
      if (!allowed) throw new UserError('Границы записываются в одной из единиц показателя')
    }

    const clash = this.list(analyteId).find(
      (other) =>
        other.id !== exceptId &&
        other.labId === input.labId &&
        other.sex === sex &&
        other.condition === condition &&
        agesOverlap(other, input),
    )
    if (clash) {
      throw new UserError('Для тех же лаборатории, пола, условия и возраста правило уже есть')
    }
    return { ...input, unitId, note: input.note?.trim() || null }
  }
}
