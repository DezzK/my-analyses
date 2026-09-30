import { epochDay } from '@shared/domain/dates'
import { UserError } from '@shared/errors'

/** A date the person typed: a real calendar date, and not in the future. */
export function assertPastDate(value: string, what: string, today: string): void {
  if (epochDay(value) === null) throw new UserError(`Проверьте поле «${what}»`)
  if (value > today) throw new UserError(`Поле «${what}» не может быть в будущем`)
}

/** The longest name the person gives to what they keep: a patient, a panel, a report template. */
export const MAX_NAME_LENGTH = 80

/**
 * A name the person typed, trimmed. An empty one is refused with `missing`, which asks for it;
 * one longer than `maxLength` with a message that calls it `noun`.
 */
export function typedName(
  value: string,
  missing: string,
  { maxLength = MAX_NAME_LENGTH, noun = 'Название' }: { maxLength?: number; noun?: string } = {},
): string {
  const name = value.trim()
  if (!name) throw new UserError(missing)
  if (name.length > maxLength) throw new UserError(`${noun} длиннее ${maxLength} символов`)
  return name
}
