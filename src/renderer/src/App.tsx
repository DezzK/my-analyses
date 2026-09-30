import { useEffect } from 'react'
import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { REPORT_PRINT_ROUTE } from '@shared/report'
import { CurrentPatientProvider } from './patients/current'
import { queryClient, subscribeToAppEvents } from './queries'
import { router } from './router'
import { theme } from './theme'

/** A window that draws a report for printing: paper is white whatever the system theme. */
const PRINTING = window.location.hash.startsWith(`#${REPORT_PRINT_ROUTE}`)

export function App() {
  useEffect(() => subscribeToAppEvents(), [])
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      forceColorScheme={PRINTING ? 'light' : undefined}
    >
      <DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ModalsProvider labels={{ confirm: 'OK', cancel: 'Отмена' }}>
            <Notifications position="bottom-right" />
            <CurrentPatientProvider>
              <RouterProvider router={router} />
            </CurrentPatientProvider>
          </ModalsProvider>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  )
}
