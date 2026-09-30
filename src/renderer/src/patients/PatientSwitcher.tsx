import { useState } from 'react'
import { Avatar, Group, Menu, Text, UnstyledButton } from '@mantine/core'
import { IconCheck, IconChevronDown, IconPencil, IconUserPlus } from '@tabler/icons-react'
import type { Patient } from '@shared/api'
import { formatAge } from '../format'
import { useCurrentPatient } from './current'
import { PatientModal } from './PatientModal'

/** Two stacked lines (name, age) fit the header's height. */
const COMPACT_LINE_HEIGHT = 1.2

function initials(title: string): string {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function PatientSwitcher() {
  const { patient, patients, select } = useCurrentPatient()
  const [modal, setModal] = useState<{ patient: Patient | null } | null>(null)

  return (
    <>
      <Menu position="bottom-end" width={260} shadow="md">
        <Menu.Target>
          <UnstyledButton className="no-drag" px="xs" py={4} style={{ borderRadius: 8 }}>
            <Group gap="xs" wrap="nowrap">
              <Avatar color="teal" radius="xl" size={30}>
                {patient ? initials(patient.title) : '?'}
              </Avatar>
              <div>
                <Text size="sm" fw={600} lh={COMPACT_LINE_HEIGHT}>
                  {patient?.title ?? 'Нет пациента'}
                </Text>
                {patient && (
                  <Text size="xs" c="dimmed" lh={COMPACT_LINE_HEIGHT}>
                    {formatAge(patient.birthDate)}
                  </Text>
                )}
              </div>
              <IconChevronDown size={14} />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Пациенты</Menu.Label>
          {patients.map((p) => (
            <Menu.Item
              key={p.id}
              onClick={() => select(p.id)}
              rightSection={p.id === patient?.id ? <IconCheck size={14} /> : null}
            >
              {p.title}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconUserPlus size={16} />} onClick={() => setModal({ patient: null })}>
            Новый пациент…
          </Menu.Item>
          {patient && (
            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setModal({ patient })}>
              Изменить «{patient.title}»…
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      <PatientModal
        opened={modal !== null}
        patient={modal?.patient ?? null}
        onClose={() => setModal(null)}
        onCreated={(created) => select(created.id)}
      />
    </>
  )
}
