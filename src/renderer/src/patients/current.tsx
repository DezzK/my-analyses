import { createContext, useContext, type ReactNode } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import type { Patient } from '@shared/api'
import { usePatients } from '../queries'

const STORAGE_KEY = 'my-analyses:selected-patient'

interface Selection {
  selectedId: number | null
  select(id: number): void
}

const SelectionContext = createContext<Selection | null>(null)

export function CurrentPatientProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useLocalStorage<number | null>({ key: STORAGE_KEY, defaultValue: null })
  return (
    <SelectionContext.Provider value={{ selectedId, select: setSelectedId }}>
      {children}
    </SelectionContext.Provider>
  )
}

/** The patient every screen shows: the remembered one, or the first one when it is gone. */
export function useCurrentPatient(): {
  patient: Patient | null
  patients: Patient[]
  isLoading: boolean
  select(id: number): void
} {
  const selection = useContext(SelectionContext)
  if (!selection) throw new Error('useCurrentPatient needs CurrentPatientProvider')
  const { data: patients = [], isLoading } = usePatients()
  const patient = patients.find((p) => p.id === selection.selectedId) ?? patients[0] ?? null
  return { patient, patients, isLoading, select: selection.select }
}
