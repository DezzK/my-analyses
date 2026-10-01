import type { ReactNode } from 'react'
import { ActionIcon, AppShell, Badge, Group, NavLink, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core'
import { useHotkeys } from '@mantine/hooks'
import {
  IconArrowLeft,
  IconArrowsShuffle,
  IconBook2,
  IconBuildingHospital,
  IconFileText,
  IconFlask,
  IconHeartbeat,
  IconLayoutDashboard,
  IconSettings,
} from '@tabler/icons-react'
import { Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import { pendingCount } from '../mapping/MappingPage'
import { useCurrentPatient } from '../patients/current'
import { PatientSwitcher } from '../patients/PatientSwitcher'
import { IS_MAC } from '../platform'
import { useMappingQueue } from '../queries'
import { AnalyteSearch, SearchButton } from '../search/AnalyteSearch'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'
import { useUpdateReadyNotice } from '../updates'

/** Room for the macOS traffic lights, which sit over the header instead of a title bar. */
const MAC_TRAFFIC_LIGHTS_INSET = 88

interface Section {
  to: '/' | '/orders' | '/labs' | '/mapping' | '/catalog' | '/reports' | '/settings'
  label: string
  icon: ReactNode
}

const SECTIONS: Section[] = [
  { to: '/', label: 'Обзор', icon: <IconLayoutDashboard size={ICON_SIZE.shell} /> },
  { to: '/orders', label: 'Заказы', icon: <IconFlask size={ICON_SIZE.shell} /> },
  { to: '/labs', label: 'Лаборатории', icon: <IconBuildingHospital size={ICON_SIZE.shell} /> },
  { to: '/mapping', label: 'Сопоставление', icon: <IconArrowsShuffle size={ICON_SIZE.shell} /> },
  { to: '/catalog', label: 'Справочник', icon: <IconBook2 size={ICON_SIZE.shell} /> },
  { to: '/reports', label: 'Отчёты', icon: <IconFileText size={ICON_SIZE.shell} /> },
]

const SETTINGS: Section = {
  to: '/settings',
  label: 'Настройки',
  icon: <IconSettings size={ICON_SIZE.shell} />,
}

function SectionLink({
  section,
  pathname,
  count = 0,
}: {
  section: Section
  pathname: string
  count?: number
}) {
  const active = section.to === '/' ? pathname === '/' : pathname.startsWith(section.to)
  return (
    <NavLink
      component={Link}
      to={section.to}
      label={section.label}
      leftSection={section.icon}
      active={active}
      rightSection={
        count > 0 ? (
          <Badge size="sm" variant="filled" aria-label={`Ждут проверки: ${count}`}>
            {count}
          </Badge>
        ) : null
      }
      style={{ borderRadius: 8 }}
    />
  )
}

/** The keys that go back, as each platform's browsers have them, and how the platform writes them. */
const BACK_KEYS = IS_MAC ? { hotkey: 'mod+[', label: '⌘[' } : { hotkey: 'alt+ArrowLeft', label: 'Alt+←' }

/** Goes back to the page before, the way a browser's back button and a mouse's back button do. */
function BackButton() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const back = () => {
    if (canGoBack) router.history.back()
  }
  useHotkeys([[BACK_KEYS.hotkey, back]])
  return (
    <Tooltip label={`Назад (${BACK_KEYS.label})`} disabled={!canGoBack}>
      <ActionIcon
        className="no-drag"
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Назад"
        disabled={!canGoBack}
        onClick={back}
      >
        <IconArrowLeft size={ICON_SIZE.shell} />
      </ActionIcon>
    </Tooltip>
  )
}

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { patient } = useCurrentPatient()
  const { data: queue } = useMappingQueue(patient?.id ?? null)
  const counts: Partial<Record<Section['to'], number>> = { '/mapping': pendingCount(queue) }
  useUpdateReadyNotice()
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 232, breakpoint: 0 }} padding="xl">
      <AppShell.Header className="drag-region" pl={IS_MAC ? MAC_TRAFFIC_LIGHTS_INSET : 'md'} pr="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <BackButton />
            <ThemeIcon variant="light" radius="md" size="md">
              <IconHeartbeat size={ICON_SIZE.shell} />
            </ThemeIcon>
            <Text fw={TITLE_WEIGHT}>Мои анализы</Text>
          </Group>
          <SearchButton />
          <PatientSwitcher />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <Stack gap={2} style={{ flex: 1 }}>
          {SECTIONS.map((section) => (
            <SectionLink key={section.to} section={section} pathname={pathname} count={counts[section.to]} />
          ))}
        </Stack>
        <SectionLink section={SETTINGS} pathname={pathname} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
      <AnalyteSearch />
    </AppShell>
  )
}
