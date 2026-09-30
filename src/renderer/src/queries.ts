import { QueryClient, useQuery } from '@tanstack/react-query'
import type { DataScope } from '@shared/api'
import { api, onAppEvent } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    // Data only changes through this app, and every change is announced by an event below.
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
})

/** Query keys start with the data scope they depend on, so one event invalidates them all. */
export const keys = {
  patients: () => ['patients'] as const satisfies readonly [DataScope],
  periods: (patientId: number) => ['periods', patientId] as const satisfies readonly [DataScope, number],
  backups: () => ['backups'] as const,
  settings: () => ['settings'] as const,
  appInfo: () => ['app-info'] as const,
}

export function subscribeToAppEvents(): () => void {
  return onAppEvent((event) => {
    if (event.type === 'data-changed') {
      for (const scope of event.scopes) void queryClient.invalidateQueries({ queryKey: [scope] })
    } else if (event.type === 'backup-created') {
      void queryClient.invalidateQueries({ queryKey: keys.backups() })
    }
  })
}

export function usePatients() {
  return useQuery({ queryKey: keys.patients(), queryFn: () => api.patients.list() })
}

export function usePeriods(patientId: number | null) {
  return useQuery({
    queryKey: keys.periods(patientId ?? 0),
    queryFn: () => api.patients.periods(patientId ?? 0),
    enabled: patientId !== null,
  })
}

export function useBackups() {
  return useQuery({ queryKey: keys.backups(), queryFn: () => api.backups.list() })
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings(), queryFn: () => api.settings.get() })
}

export function useAppInfo() {
  return useQuery({ queryKey: keys.appInfo(), queryFn: () => api.app.info() })
}
