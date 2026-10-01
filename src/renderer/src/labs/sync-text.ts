import type { MantineColor } from '@mantine/core'
import type { SyncProgress, SyncStats } from '@shared/api'
import type { SyncStatus } from '@shared/domain/enums'
import { plural } from '../format'
import { SYNC_STAGE_LABELS } from '../labels'

export const SYNC_STATUS_COLORS: Record<SyncStatus, MantineColor> = {
  running: 'blue',
  ok: 'teal',
  error: 'red',
  blocked: 'red',
  login_required: 'yellow',
}

/** Counters worth telling the person about, with their Russian forms for 1, 2 and 5. */
const REPORTED: readonly [keyof SyncStats, readonly [string, string, string]][] = [
  ['ordersAdded', ['новый заказ', 'новых заказа', 'новых заказов']],
  ['ordersUpdated', ['заказ дополнен', 'заказа дополнены', 'заказов дополнено']],
  ['analytesCreated', ['новый показатель', 'новых показателя', 'новых показателей']],
  ['unknownUnits', ['новая единица', 'новые единицы', 'новых единиц']],
  ['resultsKeptEdited', ['ручная правка сохранена', 'ручные правки сохранены', 'ручных правок сохранено']],
  [
    'ordersWaiting',
    ['заказ ждёт выбора пациента', 'заказа ждут выбора пациента', 'заказов ждут выбора пациента'],
  ],
]

/** What a finished sync brought, in a few words. */
export function describeStats(stats: SyncStats | null): string {
  if (!stats) return ''
  const parts = REPORTED.filter(([key]) => stats[key] > 0).map(
    ([key, forms]) => `${stats[key]} ${plural(stats[key], forms)}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'нового нет'
}

export function describeProgress(progress: SyncProgress): string {
  const label = SYNC_STAGE_LABELS[progress.stage]
  return progress.total > 0 ? `${label}: ${progress.done} из ${progress.total}` : `${label}…`
}
