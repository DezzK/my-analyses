import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
import {
  CYCLE_PHASES,
  LAB_FLAGS,
  MARKER_SHAPES,
  ORDER_SOURCES,
  PERIOD_KINDS,
  REFERENCE_CONDITIONS,
  SEXES,
  SPECIMENS,
  SYNC_STATUSES,
  VALUE_KINDS,
} from '@shared/domain/enums'

/**
 * Everything a lab reports is stored as it was reported (`raw_value`, `ref_raw`, `raw_payload`);
 * interpreting those strings is the job of `src/shared/domain`, so a fix there re-interprets
 * every stored result without a migration.
 */

/** CHECK (column IN (...)) built from the same constant array that types the column. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`
}

function nullOrOneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} is null or ${oneOf(column, values)}`
}

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
const createdAt = () => text('created_at').notNull().default(isoNow)

export const patient = sqliteTable(
  'patient',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    sex: text('sex', { enum: SEXES }).notNull(),
    birthDate: text('birth_date').notNull(),
    note: text('note'),
    /** Set on delete; the row is purged on a later start, which lets the person undo. */
    deletedAt: text('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [check('patient_sex', oneOf(t.sex, SEXES))],
)

export const patientPeriod = sqliteTable(
  'patient_period',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    patientId: integer('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PERIOD_KINDS }).notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
  },
  (t) => [
    check('patient_period_kind', oneOf(t.kind, PERIOD_KINDS)),
    index('patient_period_patient').on(t.patientId),
  ],
)

export const lab = sqliteTable(
  'lab',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    /** Key of a connector in `src/main/lab/connectors`, or null for a lab entered by hand. */
    connectorId: text('connector_id'),
    markerColor: text('marker_color').notNull(),
    markerShape: text('marker_shape', { enum: MARKER_SHAPES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('lab_marker_shape', oneOf(t.markerShape, MARKER_SHAPES))],
)

export const labAccount = sqliteTable(
  'lab_account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    labId: integer('lab_id')
      .notNull()
      .references(() => lab.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    externalAccountId: text('external_account_id'),
    defaultPatientId: integer('default_patient_id').references(() => patient.id, { onDelete: 'set null' }),
    /** Electron session partition that keeps this account's cookies apart from every other one. */
    sessionPartition: text('session_partition').notNull().unique(),
    lastSyncAt: text('last_sync_at'),
    createdAt: createdAt(),
  },
  (t) => [index('lab_account_lab').on(t.labId)],
)

export const unit = sqliteTable('unit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Built-in units use the code from `src/shared/domain/units.ts`; unknown spellings get `?:<spelling>`. */
  code: text('code').notNull().unique(),
  display: text('display').notNull(),
  dimension: text('dimension').notNull(),
  scale: real('scale').notNull().default(1),
  reviewed: integer('reviewed', { mode: 'boolean' }).notNull().default(true),
})

/** Spellings the person mapped by hand; built-in spellings live in `src/shared/domain/units.ts`. */
export const unitSpelling = sqliteTable('unit_spelling', {
  spelling: text('spelling').primaryKey(),
  unitId: integer('unit_id')
    .notNull()
    .references(() => unit.id, { onDelete: 'cascade' }),
})

export const analyte = sqliteTable(
  'analyte',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    specimen: text('specimen', { enum: SPECIMENS }),
    description: text('description'),
    valueKind: text('value_kind', { enum: VALUE_KINDS }).notNull().default('numeric'),
    canonicalUnitId: integer('canonical_unit_id').references(() => unit.id, { onDelete: 'set null' }),
    /** Unit the person chose for tables, charts and reports; the canonical unit when null. */
    displayUnitId: integer('display_unit_id').references(() => unit.id, { onDelete: 'set null' }),
    /** g/mol; lets molar and mass concentrations convert into each other. */
    molarMass: real('molar_mass'),
    /** False for analytes an import created on its own until the person looks at them. */
    reviewed: integer('reviewed', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check('analyte_specimen', nullOrOneOf(t.specimen, SPECIMENS)),
    check('analyte_value_kind', oneOf(t.valueKind, VALUE_KINDS)),
  ],
)

export const analyteAlias = sqliteTable(
  'analyte_alias',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    analyteId: integer('analyte_id')
      .notNull()
      .references(() => analyte.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    labId: integer('lab_id').references(() => lab.id, { onDelete: 'cascade' }),
    /** The lab's own test code; an import finds the analyte by it. */
    labCode: text('lab_code'),
  },
  (t) => [
    uniqueIndex('analyte_alias_lab_code')
      .on(t.labId, t.labCode)
      .where(sql`${t.labCode} is not null`),
    index('analyte_alias_analyte').on(t.analyteId),
  ],
)

export const analyteUnit = sqliteTable(
  'analyte_unit',
  {
    analyteId: integer('analyte_id')
      .notNull()
      .references(() => analyte.id, { onDelete: 'cascade' }),
    unitId: integer('unit_id')
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    /** value × factor = value in the canonical unit; null when dimensions already define it. */
    factor: real('factor'),
  },
  (t) => [primaryKey({ columns: [t.analyteId, t.unitId] })],
)

export const referenceRule = sqliteTable(
  'reference_rule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    analyteId: integer('analyte_id')
      .notNull()
      .references(() => analyte.id, { onDelete: 'cascade' }),
    /** Null for a general rule; a lab makes the rule that lab's exception. */
    labId: integer('lab_id').references(() => lab.id, { onDelete: 'cascade' }),
    sex: text('sex', { enum: SEXES }),
    /** Half-open age range [from, to) in days on the collection date. */
    ageFromDays: integer('age_from_days'),
    ageToDays: integer('age_to_days'),
    condition: text('condition', { enum: REFERENCE_CONDITIONS }),
    low: real('low'),
    high: real('high'),
    /** Expected qualitative value code, for qualitative analytes. */
    expected: text('expected'),
    unitId: integer('unit_id').references(() => unit.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('reference_rule_sex', nullOrOneOf(t.sex, SEXES)),
    check('reference_rule_condition', nullOrOneOf(t.condition, REFERENCE_CONDITIONS)),
    index('reference_rule_analyte').on(t.analyteId),
  ],
)

export const labOrder = sqliteTable(
  'lab_order',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    patientId: integer('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    labId: integer('lab_id')
      .notNull()
      .references(() => lab.id, { onDelete: 'restrict' }),
    labAccountId: integer('lab_account_id').references(() => labAccount.id, { onDelete: 'set null' }),
    collectedOn: text('collected_on').notNull(),
    collectedTime: text('collected_time'),
    cyclePhase: text('cycle_phase', { enum: CYCLE_PHASES }),
    /** The lab's own key of the order; a repeated import finds the order by it. */
    externalKey: text('external_key'),
    source: text('source', { enum: ORDER_SOURCES }).notNull(),
    connectorVersion: text('connector_version'),
    rawPayload: text('raw_payload'),
    rawHash: text('raw_hash'),
    /** SHA-256 of the original lab form, stored as `<hash>.pdf` in the attachments folder. */
    pdfFile: text('pdf_file'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull().default(isoNow),
  },
  (t) => [
    check('lab_order_cycle_phase', nullOrOneOf(t.cyclePhase, CYCLE_PHASES)),
    check('lab_order_source', oneOf(t.source, ORDER_SOURCES)),
    uniqueIndex('lab_order_external')
      .on(t.labId, t.externalKey)
      .where(sql`${t.externalKey} is not null`),
    index('lab_order_patient_date').on(t.patientId, t.collectedOn),
  ],
)

export const result = sqliteTable(
  'result',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => labOrder.id, { onDelete: 'cascade' }),
    analyteId: integer('analyte_id')
      .notNull()
      .references(() => analyte.id, { onDelete: 'restrict' }),
    /** The value as the lab wrote it (or the person typed it), without the unit. */
    rawValue: text('raw_value').notNull(),
    unitId: integer('unit_id').references(() => unit.id, { onDelete: 'set null' }),
    /** The reference range as the lab printed it next to this result. */
    refRaw: text('ref_raw'),
    labFlag: text('lab_flag', { enum: LAB_FLAGS }),
    /** The lab's own key of the result inside its order. */
    externalKey: text('external_key'),
    userEdited: integer('user_edited', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
  },
  (t) => [
    check('result_lab_flag', nullOrOneOf(t.labFlag, LAB_FLAGS)),
    uniqueIndex('result_external')
      .on(t.orderId, t.externalKey)
      .where(sql`${t.externalKey} is not null`),
    index('result_analyte').on(t.analyteId),
    index('result_order').on(t.orderId),
  ],
)

export const panel = sqliteTable('panel', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: createdAt(),
})

export const panelItem = sqliteTable(
  'panel_item',
  {
    panelId: integer('panel_id')
      .notNull()
      .references(() => panel.id, { onDelete: 'cascade' }),
    analyteId: integer('analyte_id')
      .notNull()
      .references(() => analyte.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.panelId, t.analyteId] })],
)

export const reportTemplate = sqliteTable('report_template', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  /** JSON: the blocks of the report, see `ReportBlock` in `src/shared/api.ts`. */
  blocks: text('blocks').notNull().default('[]'),
  /** JSON: page layout options, see `ReportLayout` in `src/shared/api.ts`. */
  layout: text('layout').notNull().default('{}'),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull().default(isoNow),
})

export const syncRun = sqliteTable(
  'sync_run',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    labAccountId: integer('lab_account_id')
      .notNull()
      .references(() => labAccount.id, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull().default(isoNow),
    finishedAt: text('finished_at'),
    status: text('status', { enum: SYNC_STATUSES }).notNull(),
    /** JSON: counters of the run, see `SyncStats` in `src/shared/api.ts`. */
    stats: text('stats'),
    error: text('error'),
  },
  (t) => [
    check('sync_run_status', oneOf(t.status, SYNC_STATUSES)),
    index('sync_run_account').on(t.labAccountId),
  ],
)
