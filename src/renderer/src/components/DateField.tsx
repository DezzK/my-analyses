import { DateInput, type DateInputProps } from '@mantine/dates'

/** How a date is typed and shown everywhere, like `formatDateRu` in `src/shared/domain/dates.ts`. */
const DATE_FORMAT = 'DD.MM.YYYY'

export function DateField(props: DateInputProps) {
  return <DateInput placeholder="ДД.ММ.ГГГГ" valueFormat={DATE_FORMAT} {...props} />
}
