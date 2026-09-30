import type { BackupReason } from '@shared/api'
import type { AgeUnit } from '@shared/domain/age'
import type {
  LabFlag,
  PeriodKind,
  ReferenceCondition,
  Sex,
  Specimen,
  SyncStage,
  SyncStatus,
  ValueKind,
} from '@shared/domain/enums'
import type { ReferenceSource } from '@shared/domain/references'
import type { QualitativeCode } from '@shared/domain/values'

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

export const SPECIMEN_LABELS: Record<Specimen, string> = {
  blood: 'кровь',
  serum: 'сыворотка',
  plasma: 'плазма',
  urine: 'моча',
  stool: 'кал',
  saliva: 'слюна',
  other: 'другое',
}

export const QUALITATIVE_LABELS: Record<QualitativeCode, string> = {
  negative: 'отрицательно',
  positive: 'положительно',
  not_detected: 'не обнаружено',
  detected: 'обнаружено',
  doubtful: 'сомнительно',
  trace: 'следы',
}

export const LAB_FLAG_LABELS: Record<LabFlag, string> = {
  high: 'выше нормы',
  low: 'ниже нормы',
  normal: 'в норме',
  abnormal: 'вне нормы',
}

export const REFERENCE_SOURCE_LABELS: Record<ReferenceSource, string> = {
  lab: 'из бланка лаборатории',
  'lab-rule': 'правило справочника для этой лаборатории',
  'general-rule': 'общее правило справочника',
}

export const VALUE_KIND_LABELS: Record<ValueKind, string> = {
  numeric: 'Число',
  qualitative: 'Качественный ответ',
  text: 'Текст',
}

export const CONDITION_LABELS: Record<ReferenceCondition, string> = {
  pregnancy_t1: 'Беременность, I триместр',
  pregnancy_t2: 'Беременность, II триместр',
  pregnancy_t3: 'Беременность, III триместр',
  phase_follicular: 'Фолликулярная фаза',
  phase_ovulatory: 'Овуляторная фаза',
  phase_luteal: 'Лютеиновая фаза',
  postmenopause: 'Постменопауза',
}

/** Forms for 1, 2 and 5 of each unit an age limit is stated in. */
export const AGE_UNIT_FORMS: Record<AgeUnit, readonly [string, string, string]> = {
  years: ['год', 'года', 'лет'],
  months: ['месяц', 'месяца', 'месяцев'],
  days: ['день', 'дня', 'дней'],
}
