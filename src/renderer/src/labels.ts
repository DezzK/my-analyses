import type { BackupReason } from '@shared/api'
import type { PeriodKind, Sex } from '@shared/domain/enums'

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
