/**
 * Closed sets of values shared by the database schema (column types and CHECK constraints),
 * the main-process services and the UI. Each set is declared exactly once, here.
 */

export const SEXES = ['male', 'female'] as const
export type Sex = (typeof SEXES)[number]

/** Periods of a patient's life that change which reference range applies. */
export const PERIOD_KINDS = ['pregnancy', 'menopause'] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

/** Menstrual cycle phase recorded on an order; labs rarely report it themselves. */
export const CYCLE_PHASES = ['follicular', 'ovulatory', 'luteal'] as const
export type CyclePhase = (typeof CYCLE_PHASES)[number]

/** Condition a reference rule can be restricted to. */
export const REFERENCE_CONDITIONS = [
  'pregnancy_t1',
  'pregnancy_t2',
  'pregnancy_t3',
  'phase_follicular',
  'phase_ovulatory',
  'phase_luteal',
  'postmenopause',
] as const
export type ReferenceCondition = (typeof REFERENCE_CONDITIONS)[number]

export const SPECIMENS = ['blood', 'serum', 'plasma', 'urine', 'stool', 'saliva', 'other'] as const
export type Specimen = (typeof SPECIMENS)[number]

export const VALUE_KINDS = ['numeric', 'qualitative', 'text'] as const
export type ValueKind = (typeof VALUE_KINDS)[number]

/** Deviation as reported by a lab (normalized from its own vocabulary by the connector). */
export const LAB_FLAGS = ['high', 'low', 'normal', 'abnormal'] as const
export type LabFlag = (typeof LAB_FLAGS)[number]

export const ORDER_SOURCES = ['manual', 'import'] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]

export const SYNC_STATUSES = ['running', 'ok', 'error', 'blocked', 'login_required'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

/** What a running sync is busy with, shown to the person while they wait. */
export const SYNC_STAGES = ['connecting', 'listing', 'orders'] as const
export type SyncStage = (typeof SYNC_STAGES)[number]

/** Marker shapes a lab can take on charts; names match ECharts symbol names. */
export const MARKER_SHAPES = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'] as const
export type MarkerShape = (typeof MARKER_SHAPES)[number]
