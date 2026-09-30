import type { BackupReason } from '@shared/api'
import type { PeriodKind, Sex, SyncStage, SyncStatus } from '@shared/domain/enums'

/** Russian names of the shared closed sets, for the UI only. */

export const SEX_LABELS: Record<Sex, string> = { male: 'Мужской', female: 'Женский' }

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  pregnancy: 'Беременность',
  menopause: 'Менопауза',
}

export const BACKUP_REASON_LABELS: Record<BackupReason, string> = {
  startup: 'При запуске',
  change: 'После изменений',
  manual: 'Вручную',
  'pre-migration': 'Перед обновлением',
  'pre-restore': 'Перед восстановлением',
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  running: 'Идёт обновление',
  ok: 'Готово',
  error: 'Ошибка',
  blocked: 'Сайт не пустил',
  login_required: 'Нужен вход',
}

export const SYNC_STAGE_LABELS: Record<SyncStage, string> = {
  connecting: 'Открываю личный кабинет',
  listing: 'Получаю список заказов',
  orders: 'Загружаю заказы',
}
