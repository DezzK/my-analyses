import { epochDay } from '@shared/domain/dates'
import { UserError } from '@shared/errors'

/** A date the person typed: a real calendar date, and not in the future. */
export function assertPastDate(value: string, what: string, today: string): void {
  if (epochDay(value) === null) throw new UserError(`Проверьте поле «${what}»`)
  if (value > today) throw new UserError(`Поле «${what}» не может быть в будущем`)
}
