import { QueryClient, useQuery } from '@tanstack/react-query'
import type { DataScope, Lab, Unit } from '@shared/api'
import { api, onAppEvent } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    // Data only changes through this app, and every change is announced by an event below.
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
})

/**
 * Query keys start with the data scope they depend on, so one event invalidates them all.
 * Queries computed from several scopes at once — interpreted results, search — start with
 * `derived` and are refreshed by a change to any of `DERIVED_FROM`.
 */
const DERIVED = 'derived'
const DERIVED_FROM: readonly DataScope[] = ['patients', 'periods', 'orders', 'catalog']

export const keys = {
  patients: () => ['patients'] as const satisfies readonly [DataScope],
  periods: (patientId: number) => ['periods', patientId] as const satisfies readonly [DataScope, number],
  units: () => ['catalog', 'units'] as const satisfies readonly [DataScope, string],
  catalog: () => ['catalog', 'list'] as const satisfies readonly [DataScope, string],
  analyteCard: (analyteId: number) => ['catalog', 'card', analyteId] as const,
  rules: (analyteId: number) => ['catalog', 'rules', analyteId] as const,
  merges: (analyteId: number) => ['catalog', 'merges', analyteId] as const,
  panels: () => ['catalog', 'panels'] as const satisfies readonly [DataScope, string],
  labReferences: (analyteId: number) => [DERIVED, 'lab-references', analyteId] as const,
  analyteResults: (analyteId: number, patientId: number) =>
    [DERIVED, 'analyte', analyteId, patientId] as const,
  search: (query: string, patientId: number | null) => [DERIVED, 'search', query, patientId] as const,
  orders: (patientId: number) => [DERIVED, 'orders', patientId] as const,
  order: (orderId: number) => [DERIVED, 'order', orderId] as const,
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
      if (event.scopes.some((scope) => DERIVED_FROM.includes(scope))) {
        void queryClient.invalidateQueries({ queryKey: [DERIVED] })
      }
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

/** Stable selectors: TanStack Query recomputes a selection only when its function changes. */
const byId = <T extends { id: number }>(items: T[]): ReadonlyMap<number, T> =>
  new Map(items.map((item) => [item.id, item]))
const NONE = new Map()

/** Units by id, for showing the unit of any value. */
export function useUnits(): ReadonlyMap<number, Unit> {
  return (
    useQuery({ queryKey: keys.units(), queryFn: () => api.units.list(), select: byId<Unit> }).data ?? NONE
  )
}

/** Labs by id, for showing the lab of any order or result. */
export function useLabMap(): ReadonlyMap<number, Lab> {
  return useQuery({ queryKey: keys.labs(), queryFn: () => api.labs.list(), select: byId<Lab> }).data ?? NONE
}

export function useCatalog() {
  return useQuery({ queryKey: keys.catalog(), queryFn: () => api.analytes.list() })
}

export function useAnalyteCard(analyteId: number) {
  return useQuery({ queryKey: keys.analyteCard(analyteId), queryFn: () => api.analytes.card(analyteId) })
}

export function useRules(analyteId: number) {
  return useQuery({ queryKey: keys.rules(analyteId), queryFn: () => api.rules.list(analyteId) })
}

export function useMerges(analyteId: number) {
  return useQuery({ queryKey: keys.merges(analyteId), queryFn: () => api.analytes.merges(analyteId) })
}

export function useLabReferences(analyteId: number) {
  return useQuery({
    queryKey: keys.labReferences(analyteId),
    queryFn: () => api.rules.labReferences(analyteId),
  })
}

export function usePanels() {
  return useQuery({ queryKey: keys.panels(), queryFn: () => api.panels.list() })
}

export function useAnalyteResults(analyteId: number, patientId: number | null) {
  return useQuery({
    queryKey: keys.analyteResults(analyteId, patientId ?? 0),
    queryFn: () => api.analytes.results(analyteId, patientId ?? 0),
    enabled: patientId !== null,
  })
}

export function useAnalyteSearch(query: string, patientId: number | null) {
  return useQuery({
    queryKey: keys.search(query, patientId),
    queryFn: () => api.analytes.search(query, patientId),
    enabled: query.trim().length > 0,
    placeholderData: (previous) => previous,
  })
}

export function useOrders(patientId: number | null) {
  return useQuery({
    queryKey: keys.orders(patientId ?? 0),
    queryFn: () => api.orders.list(patientId ?? 0),
    enabled: patientId !== null,
  })
}

export function useOrder(orderId: number | null) {
  return useQuery({
    queryKey: keys.order(orderId ?? 0),
    queryFn: () => api.orders.get(orderId ?? 0),
    enabled: orderId !== null,
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
