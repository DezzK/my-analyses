import type { ReferenceRule } from '@shared/api'
import { daysToAge } from '@shared/domain/age'
import { formatNumber } from '@shared/domain/numbers'
import { plural } from '../format'
import { AGE_UNIT_FORMS } from '../labels'
import { boundsText } from '../results/format'

export function ageLimitText(days: number): string {
  const { value, unit } = daysToAge(days)
  return `${value} ${plural(value, AGE_UNIT_FORMS[unit])}`
}

/** "любой", "от 18 лет", "до 1 года", "1 год – 6 лет": the ages a rule covers. */
export function agesText(rule: Pick<ReferenceRule, 'ageFromDays' | 'ageToDays'>): string {
  const { ageFromDays: from, ageToDays: to } = rule
  if (from !== null && to !== null) return `${ageLimitText(from)} – ${ageLimitText(to)}`
  if (from !== null) return `от ${ageLimitText(from)}`
  if (to !== null) return `до ${ageLimitText(to)}`
  return 'любой'
}

/** The norm of a rule, spelled like a lab's reference. */
export function normText(rule: Pick<ReferenceRule, 'low' | 'high' | 'expected'>): string {
  const spell = (n: number | null) => (n === null ? null : formatNumber(n))
  return boundsText(spell(rule.low), spell(rule.high), rule.expected)
}
