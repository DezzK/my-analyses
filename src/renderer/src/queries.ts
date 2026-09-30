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
  labs: () => ['labs'] as const satisfies readonly [DataScope],
  labAccounts: () => ['labs', 'accounts'] as const satisfies readonly [DataScope, string],
  syncHistory: (accountId: number) => ['sync', accountId] as const satisfies readonly [DataScope, number],
  /** Not data: kept current by `sync-progress` events instead of being refetched. */
  syncProgress: () => ['sync-progress'] as const,
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
    } else if (event.type === 'sync-progress') {
      queryClient.setQueryData(keys.syncProgress(), event.progress)
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

export function useLabs() {
  return useQuery({ queryKey: keys.labs(), queryFn: () => api.labs.list() })
}

export function useLabAccounts() {
  return useQuery({ queryKey: keys.labAccounts(), queryFn: () => api.labs.accounts() })
}

export function useSyncHistory(accountId: number) {
  return useQuery({ queryKey: keys.syncHistory(accountId), queryFn: () => api.sync.history(accountId) })
}

export function useSyncProgress() {
  return useQuery({ queryKey: keys.syncProgress(), queryFn: () => api.sync.progress() })
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
