import { useState } from 'react'
import { Center, Loader } from '@mantine/core'
import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AnalytePage } from './analytes/AnalytePage'
import { AnalyteCardPage } from './catalog/AnalyteCardPage'
import { CatalogPage } from './catalog/CatalogPage'
import { LabsPage } from './labs/LabsPage'
import { AppLayout } from './layout/AppLayout'
import { Welcome, type WelcomeStep } from './onboarding/Welcome'
import { OrdersPage } from './orders/OrdersPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { OverviewPage } from './pages/OverviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { useCurrentPatient } from './patients/current'

function Root() {
  const { patients, isLoading, select } = useCurrentPatient()
  // Stays on 'backups' after the first patient exists, until the person finishes the wizard.
  const [welcome, setWelcome] = useState<WelcomeStep | null>(null)
  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }
  const step = welcome ?? (patients.length === 0 ? 'patient' : null)
  if (step) {
    return (
      <Welcome
        step={step}
        onPatientCreated={(patient) => {
          select(patient.id)
          setWelcome('backups')
        }}
        onFinished={() => setWelcome(null)}
      />
    )
  }
  return <AppLayout />
}

const rootRoute = createRootRoute({ component: Root })

const page = <TPath extends string>(path: TPath, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  page('/', OverviewPage),
  page('/orders', OrdersPage),
  page('/labs', LabsPage),
  page('/analytes/$analyteId', AnalytePage),
  page('/mapping', () => (
    <ComingSoonPage
      title="Сопоставление"
      description="Очередь новых показателей и единиц после импорта: проверить, объединить с существующими."
    />
  )),
  page('/catalog', CatalogPage),
  page('/catalog/$analyteId', AnalyteCardPage),
  page('/reports', () => (
    <ComingSoonPage
      title="Отчёты"
      description="Таблицы и графики по выбранным показателям, шаблоны отчётов, печать и PDF."
    />
  )),
  page('/settings', SettingsPage),
])

export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
