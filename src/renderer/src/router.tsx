import { useState } from 'react'
import { Center, Loader } from '@mantine/core'
import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LabsPage } from './labs/LabsPage'
import { AppLayout } from './layout/AppLayout'
import { Welcome, type WelcomeStep } from './onboarding/Welcome'
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

const page = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  page('/', OverviewPage),
  page('/orders', () => (
    <ComingSoonPage
      title="Заказы"
      description="История посещений лабораторий и ручной ввод результатов заказом: дата и лаборатория один раз, затем показатели."
    />
  )),
  page('/labs', LabsPage),
  page('/mapping', () => (
    <ComingSoonPage
      title="Сопоставление"
      description="Очередь новых показателей и единиц после импорта: проверить, объединить с существующими."
    />
  )),
  page('/catalog', () => (
    <ComingSoonPage
      title="Справочник"
      description="Показатели, синонимы, единицы и правила референсов по полу, возрасту, условию и лаборатории."
    />
  )),
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
