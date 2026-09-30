import { useState } from 'react'
import { Badge, Group, Kbd, Text, UnstyledButton } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { Spotlight, spotlight } from '@mantine/spotlight'
import { IconSearch } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { formatDate, plural } from '../format'
import { SPECIMEN_LABELS } from '../labels'
import { useCurrentPatient } from '../patients/current'
import { IS_MAC } from '../platform'
import { useAnalyteSearch } from '../queries'
import { ICON_SIZE } from '../theme'

/** Typing pauses this long before a search goes out; results still feel immediate. */
export const SEARCH_DEBOUNCE_MS = 150
const RESULTS_HEIGHT = 440
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K'

/** Finds an analyte by name, synonym or lab code from any screen (Ctrl+K / ⌘K). */
export function AnalyteSearch() {
  const [query, setQuery] = useState('')
  const [debounced] = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const { patient } = useCurrentPatient()
  const { data: hits = [] } = useAnalyteSearch(debounced, patient?.id ?? null)
  const navigate = useNavigate()
  const typed = query.trim().length > 0

  return (
    <Spotlight.Root
      query={query}
      onQueryChange={setQuery}
      shortcut={['mod + K']}
      scrollable
      maxHeight={RESULTS_HEIGHT}
    >
      <Spotlight.Search
        placeholder="Показатель, синоним или код теста"
        leftSection={<IconSearch size={ICON_SIZE.shell} />}
      />
      <Spotlight.ActionsList>
        {!typed && <Spotlight.Empty>Начните вводить название показателя</Spotlight.Empty>}
        {typed && hits.length === 0 && <Spotlight.Empty>Ничего не найдено</Spotlight.Empty>}
        {typed &&
          hits.map((hit) => (
            <Spotlight.Action
              key={hit.id}
              onClick={() =>
                void navigate({ to: '/analytes/$analyteId', params: { analyteId: String(hit.id) } })
              }
            >
              <Group justify="space-between" wrap="nowrap" w="100%">
                <div>
                  <Group gap={6} wrap="nowrap">
                    <Text>{hit.name}</Text>
                    {hit.specimen && (
                      <Badge size="xs" variant="light" color="gray">
                        {SPECIMEN_LABELS[hit.specimen]}
                      </Badge>
                    )}
                  </Group>
                  {hit.matched && (
                    <Text size="xs" c="dimmed">
                      {hit.matched}
                    </Text>
                  )}
                </div>
                {hit.resultCount > 0 && hit.lastCollectedOn && (
                  <Text size="xs" c="dimmed" className="tabular nowrap">
                    {hit.resultCount} {plural(hit.resultCount, ['результат', 'результата', 'результатов'])} ·{' '}
                    {formatDate(hit.lastCollectedOn)}
                  </Text>
                )}
              </Group>
            </Spotlight.Action>
          ))}
      </Spotlight.ActionsList>
    </Spotlight.Root>
  )
}

/** The search field in the window header; it opens the search. */
export function SearchButton() {
  return (
    <UnstyledButton className="no-drag" onClick={spotlight.open} aria-label="Поиск показателя">
      <Group
        gap="xs"
        wrap="nowrap"
        px="sm"
        py={6}
        w={320}
        style={{
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
        }}
      >
        <IconSearch size={ICON_SIZE.shell} color="var(--mantine-color-dimmed)" />
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          Поиск показателя
        </Text>
        <Kbd size="xs">{SHORTCUT_LABEL}</Kbd>
      </Group>
    </UnstyledButton>
  )
}
