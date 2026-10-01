import { useState } from 'react'
import { Center, Loader } from '@mantine/core'
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { REPORT_PRINT_ROUTE } from '@shared/report'
import { AnalytePage } from './analytes/AnalytePage'
import { PanelPage } from './analytes/PanelPage'
import { AnalyteCardPage } from './catalog/AnalyteCardPage'
import { CatalogPage } from './catalog/CatalogPage'
import { LabsPage } from './labs/LabsPage'
import { AppLayout } from './layout/AppLayout'
import { MappingPage } from './mapping/MappingPage'
import { Welcome, type WelcomeStep } from './onboarding/Welcome'
import { NewOrderPage } from './orders/NewOrderPage'
import { OrdersPage } from './orders/OrdersPage'
import { OverviewPage } from './pages/OverviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { useCurrentPatient } from './patients/current'
import { PrintReportPage } from './reports/PrintReportPage'
import { ReportsPage } from './reports/ReportsPage'

function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (pathname === REPORT_PRINT_ROUTE) return <Outlet />
  return <Shell />
}

function Shell() {
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
  page('/orders/new', NewOrderPage),
  page('/labs', LabsPage),
  page('/analytes/$analyteId', AnalytePage),
  page('/panels/$panelId', PanelPage),
  page('/mapping', MappingPage),
  page('/catalog', CatalogPage),
  page('/catalog/$analyteId', AnalyteCardPage),
  page('/reports', ReportsPage),
  page(REPORT_PRINT_ROUTE, PrintReportPage),
  page('/settings', SettingsPage),
])

export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
