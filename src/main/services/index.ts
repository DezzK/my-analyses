import { todayIso } from '@shared/domain/dates'
import { AttachmentStore } from '../attachments'
import type { Db } from '../db/client'
import type { EventSink } from '../events'
import { ImportService } from '../import/importer'
import { connectorFor } from '../lab/connectors'
import { AnalyteService } from './analytes'
import { LabService } from './labs'
import { MappingService } from './mapping'
import { MergeService } from './merges'
import { OrderService } from './orders'
import { PanelService } from './panels'
import { PatientService } from './patients'
import { ResultReader } from './results'
import { RuleService } from './rules'
import { UnitService } from './units'

export type Services = ReturnType<typeof createServices>

/**
 * The services over one database, wired together the one way the app and the tests both use.
 * What needs Electron (the embedded browser, windows, backups) is wired by the caller.
 */
export function createServices(deps: {
  db: Db
  events: EventSink
  attachmentsDir: string
  connectors?: typeof connectorFor
  today?: () => string
}) {
  const { db, events } = deps
  const units = new UnitService(db, events)
  const labs = new LabService(db, events, deps.connectors ?? connectorFor)
  const patients = new PatientService(db, events, deps.today ?? todayIso)
  const analytes = new AnalyteService(db, events)
  const attachments = new AttachmentStore(deps.attachmentsDir)
  const importer = new ImportService({ db, units, analytes, attachments, events })
  const merges = new MergeService({ db, analytes, events })
  const rules = new RuleService({ db, units, events })
  const panels = new PanelService(db, events)
  const results = new ResultReader({ db, units, analytes, patients })
  const today = deps.today ?? todayIso
  const orders = new OrderService({
    db,
    reader: results,
    attachments,
    patients,
    analytes,
    units,
    labs,
    events,
    today,
  })
  const mapping = new MappingService({ db, analytes, units, orders, results, patients })
  return {
    units,
    labs,
    patients,
    analytes,
    attachments,
    importer,
    merges,
    rules,
    panels,
    results,
    orders,
    mapping,
  }
}
