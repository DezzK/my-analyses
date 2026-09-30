import { useState, type Ref } from 'react'
import { Select } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useCurrentPatient } from '../patients/current'
import { useAnalyteSearch } from '../queries'
import { SEARCH_DEBOUNCE_MS } from '../search/AnalyteSearch'

/** The option that creates an analyte rather than picking one. */
const CREATE = 'create'

/** Picks an analyte by typing part of its name, a synonym or a lab code. */
export function AnalytePicker({
  value,
  onChange,
  exclude = [],
  label,
  placeholder = 'Название, синоним или код',
  autoFocus,
  error,
  onCreate,
  inputRef,
}: {
  value: { id: number; name: string } | null
  onChange: (analyte: { id: number; name: string } | null) => void
  exclude?: readonly number[]
  label?: string
  placeholder?: string
  autoFocus?: boolean
  error?: string
  /** Offers to create an analyte named as typed, for one the catalog does not have yet. */
  onCreate?: (name: string) => void
  inputRef?: Ref<HTMLInputElement>
}) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const { patient } = useCurrentPatient()
  const { data: hits = [] } = useAnalyteSearch(debounced, patient?.id ?? null)
  const found = hits.filter((hit) => !exclude.includes(hit.id))
  const typed = search.trim()
  const options = [...(value && !found.some((hit) => hit.id === value.id) ? [value] : []), ...found].map(
    (hit) => ({ value: String(hit.id), label: hit.name }),
  )
  if (onCreate && typed && typed !== value?.name) options.push({ value: CREATE, label: `Создать «${typed}»` })

  return (
    <Select
      ref={inputRef}
      label={label}
      placeholder={placeholder}
      searchable
      clearable
      autoFocus={autoFocus}
      error={error}
      searchValue={search}
      onSearchChange={setSearch}
      data={options}
      // The search itself runs in the main process; every option it returns is a match.
      filter={({ options: all }) => all}
      nothingFoundMessage={debounced.trim() ? 'Ничего не найдено' : 'Начните вводить'}
      value={value ? String(value.id) : null}
      onChange={(id, option) => {
        if (id === CREATE) onCreate?.(typed)
        else onChange(id ? { id: Number(id), name: option.label } : null)
      }}
    />
  )
}
