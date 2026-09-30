import type { LabConnector } from '../types'
import { gemotestConnector } from './gemotest'
import { helixConnector } from './helix'
import { kdlConnector } from './kdl'

/** Every connector the app ships, by the id stored in `lab.connector_id`. */
export const CONNECTORS: Readonly<Record<string, LabConnector>> = {
  [kdlConnector.id]: kdlConnector,
  [helixConnector.id]: helixConnector,
  [gemotestConnector.id]: gemotestConnector,
}

export function connectorFor(connectorId: string | null): LabConnector | null {
  return connectorId ? (CONNECTORS[connectorId] ?? null) : null
}
