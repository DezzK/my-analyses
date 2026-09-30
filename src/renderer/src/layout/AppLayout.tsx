import type { ReactNode } from 'react'
import { AppShell, Badge, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core'
import {
  IconArrowsShuffle,
  IconBook2,
  IconBuildingHospital,
  IconFileText,
  IconFlask,
  IconHeartbeat,
  IconLayoutDashboard,
  IconSettings,
} from '@tabler/icons-react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { PatientSwitcher } from '../patients/PatientSwitcher'
import { IS_MAC } from '../platform'
import { AnalyteSearch, SearchButton } from '../search/AnalyteSearch'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'

/** Room for the macOS traffic lights, which sit over the header instead of a title bar. */
const MAC_TRAFFIC_LIGHTS_INSET = 88

interface Section {
  to: '/' | '/orders' | '/labs' | '/mapping' | '/catalog' | '/reports' | '/settings'
  label: string
  icon: ReactNode
  soon?: boolean
}

const SECTIONS: Section[] = [
  { to: '/', label: 'Обзор', icon: <IconLayoutDashboard size={ICON_SIZE.shell} /> },
  { to: '/orders', label: 'Заказы', icon: <IconFlask size={ICON_SIZE.shell} /> },
  { to: '/labs', label: 'Лаборатории', icon: <IconBuildingHospital size={ICON_SIZE.shell} /> },
  { to: '/mapping', label: 'Сопоставление', icon: <IconArrowsShuffle size={ICON_SIZE.shell} />, soon: true },
  { to: '/catalog', label: 'Справочник', icon: <IconBook2 size={ICON_SIZE.shell} />, soon: true },
  { to: '/reports', label: 'Отчёты', icon: <IconFileText size={ICON_SIZE.shell} />, soon: true },
]

const SETTINGS: Section = {
  to: '/settings',
  label: 'Настройки',
  icon: <IconSettings size={ICON_SIZE.shell} />,
}

function SectionLink({ section, pathname }: { section: Section; pathname: string }) {
  const active = section.to === '/' ? pathname === '/' : pathname.startsWith(section.to)
  return (
    <NavLink
      component={Link}
      to={section.to}
      label={section.label}
      leftSection={section.icon}
      active={active}
      rightSection={
        section.soon ? (
          <Badge size="xs" variant="light" color="gray">
            скоро
          </Badge>
        ) : null
      }
      style={{ borderRadius: 8 }}
    />
  )
}

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 232, breakpoint: 0 }} padding="xl">
      <AppShell.Header className="drag-region" pl={IS_MAC ? MAC_TRAFFIC_LIGHTS_INSET : 'md'} pr="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
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
            <SectionLink key={section.to} section={section} pathname={pathname} />
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
