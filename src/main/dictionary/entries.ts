import type { Specimen } from '@shared/domain/enums'
import type { UnitCode } from '@shared/domain/units'

/**
 * One analyte of the built-in dictionary: what labs call it and what its results come in. An
 * analyte an import creates is linked to the entry its names, unit and specimen agree with, and
 * the analytes of one entry are merged into one (`AnalyteDictionary`).
 */
export interface DictionaryEntry {
  /** Stored with the analyte linked to the entry: never changed, never given to another analyte. */
  key: string
  /** How labs and people name it; word order, case, punctuation and ё do not matter. */
  names: readonly string[]
  /** The units its numbers come in; null for numbers without a unit. Words come without one. */
  units: readonly (UnitCode | null)[]
  /** Blood stands for serum and plasma as well. */
  specimen: Specimen
  /** g/mol, for analytes labs report in molar and in mass units alike. */
  molarMass?: number
  /** Whether labs answer it in words ("отрицательно"), not only in numbers. */
  words?: boolean
  /**
   * Named alike in analyses of other specimens («Лейкоциты» of urine, of stool, of semen): it is
   * this entry only when the analyte's specimen, from its name or from its analysis, is the entry's.
   */
  contextual?: boolean
}

type Units = DictionaryEntry['units']
type Details = Pick<DictionaryEntry, 'molarMass' | 'words' | 'contextual'>

/** Results without a unit: indices, ratios, words. */
const NO_UNIT: Units = [null]
const PERCENT: Units = ['%']
/** ×10⁹/л, also spelled тыс/мкл: white cells and platelets. */
const BILLIONS_PER_LITER: Units = ['10*9/L']
/** Per microliter: cells of a urine sediment, never of blood. */
const PER_MICROLITER: Units = ['/uL']
/** Ед/л, МЕ/л and мМЕ/мл alike. */
const UNITS_PER_LITER: Units = ['U/L']
/** мЕд/л, мМЕ/л and мкМЕ/мл alike. */
const MILLIUNITS_PER_LITER: Units = ['mU/L']
/** Ед/мл and МЕ/мл alike. */
const UNITS_PER_MILLILITER: Units = ['U/mL']
/** Proteins: г/л and г/дл. */
const GRAMS: Units = ['g/L', 'g/dL']
const MMOL: Units = ['mmol/L']
/** нг/мл and мкг/л alike. */
const NANOGRAMS: Units = ['ng/mL']
/** пг/мл and нг/л alike. */
const PICOGRAMS: Units = ['pg/mL']
const SECONDS: Units = ['s']
const FEMTOLITERS: Units = ['fL']
/** A finding of a microscopy or a look at a specimen, in words, named alike for every specimen. */
const IN_CONTEXT: Details = { words: true, contextual: true }
/** Answered in words alone, with `words: true`: a blood group, «отрицательно». */
const NO_NUMBERS: Units = []
/** Antibodies and antigens of infections, when not in words: an index, bare or named, or a concentration. */
const SEROLOGY: Units = [null, 'KP', 'index', 'U/mL']

/** g/mol of what the entries measure in molar and in mass units. */
export const MOLAR_MASS = {
  glucose: 180.16,
  lactate: 89.07,
  cPeptide: 3020.3,
  creatinine: 113.12,
  uricAcid: 168.11,
  bilirubin: 584.66,
  ammonia: 17.03,
  cholesterol: 386.65,
  triglycerides: 885.7,
  calcium: 40.08,
  magnesium: 24.305,
  phosphorus: 30.97,
  iron: 55.845,
  copper: 63.546,
  zinc: 65.38,
  selenium: 78.97,
  thyroxine: 776.87,
  triiodothyronine: 650.97,
  estradiol: 272.38,
  progesterone: 314.46,
  hydroxyprogesterone: 330.46,
  testosterone: 288.42,
  /** Testosterone's isomer: the same formula, C₁₉H₂₈O₂, and so the same mass. */
  dhea: 288.42,
  dheaSulfate: 368.49,
  androstenedione: 286.41,
  dihydrotestosterone: 290.44,
  /** A dimer of about 140 kDa: 1 нг/мл is 7,14 пмоль/л. */
  antiMullerianHormone: 140000,
  estriol: 288.38,
  cortisol: 362.46,
  acth: 4541,
  aldosterone: 360.44,
  parathyroidHormone: 9425,
  calcidiol: 400.64,
  calcitriol: 416.64,
  cobalamin: 1355.37,
  folicAcid: 441.4,
  retinol: 286.45,
  tocopherol: 430.71,
  ascorbicAcid: 176.12,
} as const

function entry(specimen: Specimen) {
  return (key: string, names: readonly string[], units: Units, details: Details = {}): DictionaryEntry => ({
    key,
    names,
    units,
    specimen,
    ...details,
  })
}

const blood = entry('blood')
const urine = entry('urine')
const stool = entry('stool')

/** A blood cell counted as a share of its kind and per liter; labs name both alike. */
function shareAndCount(key: string, names: readonly string[]): DictionaryEntry[] {
  return [blood(`${key}_share`, names, PERCENT), blood(`${key}_count`, names, BILLIONS_PER_LITER)]
}

/**
 * The width of a distribution of cells by volume, as its coefficient of variation in % and as its
 * standard deviation in fL; labs name both alike, the unit tells them apart.
 */
function distributionWidth(key: string, abbreviation: string, names: readonly string[]): DictionaryEntry[] {
  return [
    blood(`${key}_cv`, [abbreviation, `${abbreviation}-CV`, ...names], PERCENT),
    blood(`${key}_sd`, [abbreviation, `${abbreviation}-SD`, ...names], FEMTOLITERS),
  ]
}

/** A protein fraction of an electrophoresis, as a share of the total protein and in grams. */
function fraction(key: string, names: readonly string[]): DictionaryEntry[] {
  return [blood(`${key}_share`, names, PERCENT), blood(`${key}_mass`, names, GRAMS)]
}

/** A class of antibodies, with the end of the key its entries take; «суммарные» are all classes at once. */
const ANTIBODY_CLASSES = { IgG: 'igg', IgM: 'igm', IgA: 'iga', суммарные: 'total' } as const
type AntibodyClass = keyof typeof ANTIBODY_CLASSES

/**
 * Antibodies of each class to an infection, named the ways labs put it: «ЦМВ IgG», «Антитела к
 * цитомегаловирусу IgG», «Антитела класса IgG к ЦМВ», «IgG к ЦМВ».
 */
function antibodies(
  key: string,
  infection: {
    /** The infection named on its own. */
    names: readonly string[]
    /** The infection after «антитела к». */
    to: readonly string[]
  },
  classes: readonly AntibodyClass[],
  units: Units = SEROLOGY,
): DictionaryEntry[] {
  return classes.map((cls) =>
    blood(
      `${key}_${ANTIBODY_CLASSES[cls]}`,
      [
        ...infection.names.map((name) => `${name} ${cls}`),
        ...infection.to.flatMap((name) => [
          `Антитела к ${name} ${cls}`,
          ...(cls === 'суммарные' ? [] : [`Антитела класса ${cls} к ${name}`, `${cls} к ${name}`]),
        ]),
      ],
      units,
      { words: true },
    ),
  )
}

/** Antibodies to one antigen of the Epstein–Barr virus. */
function epsteinBarr(key: string, antigen: { abbr: string; to: readonly string[] }, cls: AntibodyClass) {
  const { abbr, to } = antigen
  return blood(
    key,
    [
      `ВЭБ ${abbr} ${cls}`,
      `EBV ${abbr} ${cls}`,
      `${abbr} ${cls}`,
      `Вирус Эпштейна-Барр ${abbr} ${cls}`,
      `Эпштейна-Барр вирус ${abbr} ${cls}`,
      `Антитела к ${abbr} ${cls}`,
      `Антитела к ${abbr} ВЭБ ${cls}`,
      ...to.flatMap((name) => [
        `Антитела к ${name} вируса Эпштейна-Барр ${cls}`,
        `Антитела класса ${cls} к ${name} вируса Эпштейна-Барр`,
        `${cls} к ${name} вируса Эпштейна-Барр`,
        `Антитела к ${name} ВЭБ ${cls}`,
      ]),
    ],
    SEROLOGY,
    { words: true },
  )
}

const CAPSID = { abbr: 'VCA', to: ['капсидному антигену'] }
const NUCLEAR = { abbr: 'EBNA', to: ['ядерному антигену', 'нуклеарному антигену'] }
const EARLY = { abbr: 'EA', to: ['раннему антигену'] }

const CHOLESTEROL = { molarMass: MOLAR_MASS.cholesterol }
const CHOLESTEROL_UNITS: Units = ['mmol/L', 'mg/dL']
const BILIRUBIN_UNITS: Units = ['umol/L', 'mg/dL']
const IRON_UNITS: Units = ['umol/L', 'ug/dL']

/**
 * The analytes Russian labs measure most, as they name them. A name matches only as a whole (in
 * any word order) or through its bracketed and comma-separated parts, so each entry lists the
 * spellings in use rather than fragments of them.
 */
export const DICTIONARY: readonly DictionaryEntry[] = [
  // Complete blood count.
  blood('hemoglobin', ['Гемоглобин', 'HGB', 'Hb', 'Hemoglobin'], GRAMS),
  blood('erythrocytes', ['Эритроциты', 'RBC', 'Red blood cells'], ['10*12/L']),
  blood('hematocrit', ['Гематокрит', 'HCT', 'Ht', 'Hematocrit'], PERCENT),
  blood(
    'mcv',
    ['MCV', 'Средний объем эритроцита', 'Средний объем эритроцитов', 'Mean corpuscular volume'],
    FEMTOLITERS,
  ),
  blood(
    'mch',
    [
      'MCH',
      'Среднее содержание гемоглобина в эритроците',
      'Среднее содержание гемоглобина в эритроцитах',
      'Среднее содержание Hb в эритроците',
      'Среднее содержание Hb в эритроцитах',
      'Mean corpuscular hemoglobin',
    ],
    ['pg'],
  ),
  blood(
    'mchc',
    [
      'MCHC',
      'Средняя концентрация гемоглобина в эритроцитах',
      'Средняя концентрация гемоглобина в эритроците',
      'Средняя концентрация Hb в эритроцитах',
      'Средняя концентрация Hb в эритроците',
      'Mean corpuscular hemoglobin concentration',
    ],
    GRAMS,
  ),
  ...distributionWidth('rdw', 'RDW', [
    'Ширина распределения эритроцитов',
    'Отн. ширина распред. эритр. по объему',
    'Ширина распределения эритроцитов по объему',
    'Распределение эритроцитов по объему',
    'Распределение эритроцитов по величине',
    'Анизоцитоз эритроцитов',
    'Red cell distribution width',
  ]),
  blood('platelets', ['Тромбоциты', 'PLT', 'Platelets'], BILLIONS_PER_LITER),
  blood(
    'mpv',
    ['MPV', 'Средний объем тромбоцитов', 'Средний объем тромбоцита', 'Mean platelet volume'],
    FEMTOLITERS,
  ),
  ...distributionWidth('pdw', 'PDW', [
    'Ширина распределения тромбоцитов',
    'Ширина распределения тромбоцитов по объему',
    'Относительная ширина распределения тромбоцитов по объему',
    'Относит. ширина распред. тромбоцитов по объему',
    'Platelet distribution width',
  ]),
  blood('plateletcrit', ['Тромбокрит', 'PCT', 'Plateletcrit'], PERCENT),
  blood(
    'p_lcr',
    [
      'P-LCR',
      'Коэффициент больших тромбоцитов',
      'Коэффициент крупных тромбоцитов',
      'Доля крупных тромбоцитов',
      'Доля больших тромбоцитов',
      'Platelet large cell ratio',
    ],
    PERCENT,
  ),
  blood('leukocytes', ['Лейкоциты', 'WBC', 'White blood cells'], BILLIONS_PER_LITER),
  ...shareAndCount('neutrophils', [
    'Нейтрофилы',
    'Нейтрофилы общие',
    'Нейтрофилы (общ. число)',
    'NE',
    'NEU',
    'NEUT',
    'Neutrophils',
  ]),
  ...shareAndCount('band_neutrophils', [
    'Палочкоядерные нейтрофилы',
    'Нейтрофилы палочкоядерные',
    'Палочкоядерные',
    'Палочкоядерные нейтрофилы п/я',
  ]),
  ...shareAndCount('segmented_neutrophils', [
    'Сегментоядерные нейтрофилы',
    'Нейтрофилы сегментоядерные',
    'Сегментоядерные',
    'Сегментоядерные нейтрофилы с/я',
  ]),
  ...shareAndCount('lymphocytes', ['Лимфоциты', 'LY', 'LYM', 'LYMPH', 'Lymphocytes']),
  ...shareAndCount('monocytes', ['Моноциты', 'MO', 'MON', 'MONO', 'Monocytes']),
  ...shareAndCount('eosinophils', ['Эозинофилы', 'EO', 'EOS', 'Eosinophils']),
  ...shareAndCount('basophils', ['Базофилы', 'BA', 'BAS', 'BASO', 'Basophils']),
  ...shareAndCount('granulocytes', ['Гранулоциты', 'GRA', 'GRAN', 'Granulocytes']),
  ...shareAndCount('mid_cells', ['MID', 'MXD', 'Средние клетки', 'Смесь моноцитов, эозинофилов и базофилов']),
  ...shareAndCount('immature_granulocytes', ['Незрелые гранулоциты', 'IG', 'Immature granulocytes']),
  ...shareAndCount('normoblasts', ['Нормобласты', 'NRBC', 'Ядросодержащие эритроциты']),
  blood('reticulocytes_share', ['Ретикулоциты', 'RET', 'Reticulocytes'], PERCENT),
  blood('reticulocytes_count', ['Ретикулоциты', 'RET', 'Reticulocytes'], ['10*9/L', '10*12/L']),
  blood('metamyelocytes', ['Метамиелоциты'], PERCENT),
  blood('myelocytes', ['Миелоциты'], PERCENT),
  blood('blasts', ['Бласты', 'Бластные клетки'], PERCENT),
  blood('plasma_cells', ['Плазматические клетки', 'Плазмоциты'], PERCENT),
  blood(
    'reactive_lymphocytes',
    ['Реактивные лимфоциты', 'Атипичные лимфоциты', 'Атипичные мононуклеары'],
    PERCENT,
  ),
  blood(
    'esr',
    [
      'СОЭ',
      'Скорость оседания эритроцитов',
      'СОЭ по Вестергрену',
      'СОЭ по Панченкову',
      'ESR',
      'Erythrocyte sedimentation rate',
    ],
    ['mm/h'],
  ),
  blood('color_index', ['Цветовой показатель', 'ЦП'], NO_UNIT),

  // Carbohydrates.
  blood('glucose', ['Глюкоза', 'Глюкоза натощак', 'Сахар крови', 'GLU', 'Glucose'], ['mmol/L', 'mg/dL'], {
    molarMass: MOLAR_MASS.glucose,
  }),
  blood(
    'hba1c',
    [
      'Гликированный гемоглобин',
      'Гликозилированный гемоглобин',
      'Гликированный гемоглобин HbA1c',
      'Гликированный гемоглобин A1c',
      'Гемоглобин A1c',
      'HbA1c',
      'Hb A1c',
      'Glycated hemoglobin',
    ],
    PERCENT,
  ),
  blood('fructosamine', ['Фруктозамин', 'Fructosamine'], ['umol/L']),
  blood('insulin', ['Инсулин', 'Инсулин натощак', 'Insulin'], MILLIUNITS_PER_LITER),
  blood('c_peptide', ['С-пептид', 'C-peptide'], ['ng/mL', 'nmol/L', 'pmol/L'], {
    molarMass: MOLAR_MASS.cPeptide,
  }),
  blood(
    'homa_ir',
    [
      'HOMA-IR',
      'HOMA',
      'Индекс HOMA',
      'Индекс HOMA-IR',
      'Индекс инсулинорезистентности',
      'Индекс инсулинорезистентности HOMA-IR',
    ],
    NO_UNIT,
  ),
  blood('caro_index', ['Индекс Caro', 'Индекс Каро', 'Caro'], NO_UNIT),
  blood('lactate', ['Лактат', 'Молочная кислота', 'Lactate'], ['mmol/L', 'mg/dL'], {
    molarMass: MOLAR_MASS.lactate,
  }),

  // Proteins and the kidneys.
  blood('total_protein', ['Общий белок', 'Белок общий', 'Total protein', 'TP'], GRAMS),
  blood('albumin', ['Альбумин', 'Альбумины', 'Альбуминовая фракция', 'ALB', 'Albumin'], GRAMS),
  blood('prealbumin', ['Преальбумин', 'Транстиретин', 'Prealbumin'], ['g/L', 'mg/dL', 'mg/L']),
  blood('urea', ['Мочевина', 'Urea'], MMOL),
  blood('creatinine', ['Креатинин', 'CREA', 'Creatinine'], ['umol/L', 'mg/dL'], {
    molarMass: MOLAR_MASS.creatinine,
  }),
  blood(
    'egfr',
    [
      'СКФ',
      'рСКФ',
      'Скорость клубочковой фильтрации',
      'Расчетная скорость клубочковой фильтрации',
      'СКФ по CKD-EPI',
      'СКФ CKD-EPI',
      'Скорость клубочковой фильтрации по CKD-EPI',
      'СКФ по формуле CKD-EPI',
      'eGFR',
      'GFR',
    ],
    ['mL/min/1.73m2'],
  ),
  blood('uric_acid', ['Мочевая кислота', 'Ураты', 'Uric acid'], ['umol/L', 'mmol/L', 'mg/dL'], {
    molarMass: MOLAR_MASS.uricAcid,
  }),
  blood('cystatin_c', ['Цистатин C', 'Cystatin C'], ['mg/L']),
  blood(
    'beta2_microglobulin',
    ['Бета-2-микроглобулин', 'β2-микроглобулин', 'Beta-2 microglobulin'],
    ['mg/L'],
  ),
  blood('haptoglobin', ['Гаптоглобин', 'Haptoglobin'], ['g/L', 'mg/dL']),
  blood(
    'alpha1_antitrypsin',
    ['Альфа-1-антитрипсин', 'α1-антитрипсин', 'Alpha-1 antitrypsin'],
    ['g/L', 'mg/dL'],
  ),
  blood('ceruloplasmin', ['Церулоплазмин', 'Ceruloplasmin'], ['g/L', 'mg/dL', 'mg/L']),
  // In grams, an electrophoresis's albumin is the albumin above.
  blood('albumin_share', ['Альбумин', 'Альбумины', 'Альбуминовая фракция'], PERCENT),
  ...fraction('alpha1_globulins', [
    'Альфа-1-глобулины',
    'Альфа-1-глобулин',
    'α1-глобулины',
    'Альфа-1-глобулиновая фракция',
  ]),
  ...fraction('alpha2_globulins', [
    'Альфа-2-глобулины',
    'Альфа-2-глобулин',
    'α2-глобулины',
    'Альфа-2-глобулиновая фракция',
  ]),
  ...fraction('beta_globulins', [
    'Бета-глобулины',
    'Бета-глобулин',
    'β-глобулины',
    'Бета-глобулиновая фракция',
  ]),
  ...fraction('beta1_globulins', ['Бета-1-глобулины', 'Бета-1-глобулин', 'β1-глобулины']),
  ...fraction('beta2_globulins', ['Бета-2-глобулины', 'Бета-2-глобулин', 'β2-глобулины']),
  ...fraction('gamma_globulins', [
    'Гамма-глобулины',
    'Гамма-глобулин',
    'γ-глобулины',
    'Гамма-глобулиновая фракция',
  ]),
  blood(
    'albumin_globulin_ratio',
    ['А/Г коэффициент', 'Альбумин-глобулиновый коэффициент', 'Альбумин/глобулиновый коэффициент', 'A/G'],
    NO_UNIT,
  ),

  // The liver and the pancreas.
  blood(
    'bilirubin_total',
    ['Билирубин общий', 'Общий билирубин', 'TBIL', 'BIL-T', 'Total bilirubin', 'Bilirubin total'],
    BILIRUBIN_UNITS,
    { molarMass: MOLAR_MASS.bilirubin },
  ),
  blood(
    'bilirubin_direct',
    [
      'Билирубин прямой',
      'Прямой билирубин',
      'Билирубин связанный',
      'Связанный билирубин',
      'Билирубин конъюгированный',
      'DBIL',
      'BIL-D',
      'Direct bilirubin',
    ],
    BILIRUBIN_UNITS,
    { molarMass: MOLAR_MASS.bilirubin },
  ),
  blood(
    'bilirubin_indirect',
    [
      'Билирубин непрямой',
      'Непрямой билирубин',
      'Билирубин свободный',
      'Свободный билирубин',
      'Билирубин несвязанный',
      'Indirect bilirubin',
    ],
    BILIRUBIN_UNITS,
    { molarMass: MOLAR_MASS.bilirubin },
  ),
  blood(
    'alt',
    ['АЛТ', 'АлАТ', 'Аланинаминотрансфераза', 'Аланиновая аминотрансфераза', 'ALT', 'ALAT', 'GPT'],
    UNITS_PER_LITER,
  ),
  blood(
    'ast',
    ['АСТ', 'АсАТ', 'Аспартатаминотрансфераза', 'Аспарагиновая аминотрансфераза', 'AST', 'ASAT', 'GOT'],
    UNITS_PER_LITER,
  ),
  blood(
    'ggt',
    [
      'ГГТ',
      'ГГТП',
      'Гамма-ГТ',
      'γ-ГТ',
      'Гамма-глутамилтрансфераза',
      'Гамма-глутамилтранспептидаза',
      'GGT',
      'Gamma-GT',
    ],
    UNITS_PER_LITER,
  ),
  blood(
    'alp',
    ['Щелочная фосфатаза', 'Фосфатаза щелочная', 'ЩФ', 'ALP', 'Alkaline phosphatase'],
    UNITS_PER_LITER,
  ),
  blood('ldh', ['ЛДГ', 'Лактатдегидрогеназа', 'LDH', 'Lactate dehydrogenase'], UNITS_PER_LITER),
  blood('cholinesterase', ['Холинэстераза', 'Псевдохолинэстераза', 'Cholinesterase'], UNITS_PER_LITER),
  blood('bile_acids', ['Желчные кислоты', 'Bile acids'], ['umol/L']),
  blood('ammonia', ['Аммиак', 'Ammonia'], ['umol/L', 'ug/dL'], { molarMass: MOLAR_MASS.ammonia }),
  blood(
    'amylase',
    ['Амилаза', 'Альфа-амилаза', 'α-амилаза', 'Амилаза общая', 'Общая амилаза', 'AMY', 'Amylase'],
    UNITS_PER_LITER,
  ),
  blood(
    'pancreatic_amylase',
    [
      'Амилаза панкреатическая',
      'Панкреатическая амилаза',
      'Альфа-амилаза панкреатическая',
      'Pancreatic amylase',
    ],
    UNITS_PER_LITER,
  ),
  blood('lipase', ['Липаза', 'Lipase'], UNITS_PER_LITER),
  blood(
    'creatine_kinase',
    ['Креатинкиназа', 'Креатинкиназа общая', 'Креатинфосфокиназа', 'КФК', 'КФК общая', 'CK', 'CPK'],
    UNITS_PER_LITER,
  ),
  blood('ck_mb', ['Креатинкиназа-МВ', 'КФК-МВ', 'КК-МВ', 'CK-MB'], UNITS_PER_LITER),
  blood('ck_mb_mass', ['Креатинкиназа-МВ', 'КФК-МВ', 'КК-МВ', 'CK-MB', 'CK-MB масса'], NANOGRAMS),

  // Lipids.
  blood(
    'cholesterol',
    [
      'Холестерин',
      'Холестерин общий',
      'Общий холестерин',
      'Холестерол',
      'Холестерол общий',
      'ХС',
      'ОХС',
      'CHOL',
      'Cholesterol',
      'Total cholesterol',
    ],
    CHOLESTEROL_UNITS,
    CHOLESTEROL,
  ),
  blood(
    'hdl',
    [
      'Холестерин ЛПВП',
      'ЛПВП',
      'ХС-ЛПВП',
      'ЛПВП-холестерин',
      'Холестерин липопротеинов высокой плотности',
      'Холестерин липопротеидов высокой плотности',
      'Липопротеины высокой плотности',
      'Липопротеиды высокой плотности',
      'Альфа-холестерин',
      'HDL',
      'HDL-C',
      'HDL cholesterol',
    ],
    CHOLESTEROL_UNITS,
    CHOLESTEROL,
  ),
  blood(
    'ldl',
    [
      'Холестерин ЛПНП',
      'ЛПНП',
      'ХС-ЛПНП',
      'ЛПНП-холестерин',
      'Холестерин липопротеинов низкой плотности',
      'Холестерин липопротеидов низкой плотности',
      'Липопротеины низкой плотности',
      'Липопротеиды низкой плотности',
      'Холестерин ЛПНП прямой',
      'Холестерин ЛПНП расчетный',
      'Бета-холестерин',
      'LDL',
      'LDL-C',
      'LDL cholesterol',
    ],
    CHOLESTEROL_UNITS,
    CHOLESTEROL,
  ),
  blood(
    'vldl',
    [
      'Холестерин ЛПОНП',
      'ЛПОНП',
      'ХС-ЛПОНП',
      'Холестерин липопротеинов очень низкой плотности',
      'Холестерин липопротеидов очень низкой плотности',
      'Липопротеины очень низкой плотности',
      'Липопротеиды очень низкой плотности',
      'VLDL',
      'VLDL-C',
    ],
    CHOLESTEROL_UNITS,
    CHOLESTEROL,
  ),
  blood(
    'non_hdl',
    [
      'Холестерин не-ЛПВП',
      'Не-ЛПВП холестерин',
      'ХС не-ЛПВП',
      'Холестерин, не входящий в состав ЛПВП',
      'Non-HDL',
      'Non-HDL cholesterol',
    ],
    CHOLESTEROL_UNITS,
    CHOLESTEROL,
  ),
  blood('triglycerides', ['Триглицериды', 'ТГ', 'TG', 'TRIG', 'Triglycerides'], ['mmol/L', 'mg/dL'], {
    molarMass: MOLAR_MASS.triglycerides,
  }),
  blood(
    'atherogenic_index',
    ['Коэффициент атерогенности', 'Индекс атерогенности', 'КА', 'Atherogenic index'],
    NO_UNIT,
  ),
  blood(
    'apo_a1',
    [
      'Аполипопротеин A1',
      'Аполипопротеин A-I',
      'Апо A1',
      'Апо-A1',
      'ApoA1',
      'Apo A1',
      'Apo A-I',
      'Apolipoprotein A1',
    ],
    ['g/L', 'mg/dL'],
  ),
  blood(
    'apo_b',
    [
      'Аполипопротеин B',
      'Аполипопротеин B-100',
      'Апо B',
      'Апо-B',
      'ApoB',
      'Apo B',
      'Apo B-100',
      'Apolipoprotein B',
    ],
    ['g/L', 'mg/dL'],
  ),
  blood('apo_ratio', ['Апо B/Апо A1', 'ApoB/ApoA1', 'Аполипопротеин B/Аполипопротеин A1'], NO_UNIT),
  blood(
    'lipoprotein_a',
    ['Липопротеин (a)', 'Липопротеин а', 'Lp(a)', 'Lipoprotein (a)', 'ЛП(а)'],
    ['mg/dL', 'g/L', 'mg/L', 'nmol/L'],
  ),
  blood('homocysteine', ['Гомоцистеин', 'Homocysteine'], ['umol/L']),

  // Electrolytes and minerals.
  blood('potassium', ['Калий', 'K', 'K+', 'Potassium'], MMOL),
  blood('sodium', ['Натрий', 'Na', 'Na+', 'Sodium'], MMOL),
  blood('chloride', ['Хлор', 'Хлориды', 'Cl', 'Cl-', 'Chloride'], MMOL),
  blood(
    'calcium',
    ['Кальций', 'Кальций общий', 'Общий кальций', 'Ca', 'Calcium', 'Calcium total'],
    ['mmol/L', 'mg/dL'],
    { molarMass: MOLAR_MASS.calcium },
  ),
  blood(
    'ionized_calcium',
    ['Кальций ионизированный', 'Ионизированный кальций', 'Ca++', 'Ca2+', 'Ionized calcium'],
    MMOL,
    { molarMass: MOLAR_MASS.calcium },
  ),
  blood('magnesium', ['Магний', 'Mg', 'Magnesium'], ['mmol/L', 'mg/dL'], { molarMass: MOLAR_MASS.magnesium }),
  blood(
    'phosphorus',
    ['Фосфор', 'Фосфор неорганический', 'Неорганический фосфор', 'Фосфаты', 'P', 'Phosphorus', 'Phosphate'],
    ['mmol/L', 'mg/dL'],
    { molarMass: MOLAR_MASS.phosphorus },
  ),
  blood(
    'iron',
    ['Железо', 'Железо сывороточное', 'Сывороточное железо', 'Fe', 'Iron', 'Serum iron'],
    IRON_UNITS,
    {
      molarMass: MOLAR_MASS.iron,
    },
  ),
  blood(
    'tibc',
    ['ОЖСС', 'Общая железосвязывающая способность', 'Общая железосвязывающая способность сыворотки', 'TIBC'],
    IRON_UNITS,
    { molarMass: MOLAR_MASS.iron },
  ),
  blood(
    'uibc',
    [
      'ЛЖСС',
      'НЖСС',
      'Латентная железосвязывающая способность',
      'Латентная железосвязывающая способность сыворотки',
      'Ненасыщенная железосвязывающая способность',
      'UIBC',
    ],
    IRON_UNITS,
    { molarMass: MOLAR_MASS.iron },
  ),
  blood('transferrin', ['Трансферрин', 'Transferrin'], ['g/L', 'mg/dL']),
  blood(
    'transferrin_saturation',
    [
      'Коэффициент насыщения трансферрина железом',
      'Насыщение трансферрина железом',
      'Насыщение трансферрина',
      'Процент насыщения трансферрина',
      'КНТЖ',
      'НТЖ',
      'Transferrin saturation',
      'TSAT',
    ],
    PERCENT,
  ),
  blood('ferritin', ['Ферритин', 'Ferritin'], NANOGRAMS),
  blood(
    'soluble_transferrin_receptor',
    ['Растворимые рецепторы трансферрина', 'Растворимый рецептор трансферрина', 'sTfR'],
    ['mg/L'],
  ),
  blood('copper', ['Медь', 'Cu', 'Copper'], ['umol/L', 'ug/dL', 'ug/mL'], { molarMass: MOLAR_MASS.copper }),
  blood('zinc', ['Цинк', 'Zn', 'Zinc'], ['umol/L', 'ug/dL', 'ug/mL'], { molarMass: MOLAR_MASS.zinc }),
  blood('selenium', ['Селен', 'Se', 'Selenium'], ['ug/L', 'umol/L'], { molarMass: MOLAR_MASS.selenium }),

  // Inflammation and coagulation.
  blood(
    'crp',
    ['С-реактивный белок', 'СРБ', 'CRP', 'C-reactive protein', 'С-реактивный белок количественно'],
    ['mg/L', 'mg/dL'],
  ),
  blood(
    'hs_crp',
    [
      'С-реактивный белок высокочувствительный',
      'Высокочувствительный С-реактивный белок',
      'С-реактивный белок ультрачувствительный',
      'СРБ высокочувствительный',
      'СРБ ультрачувствительный',
      'вчСРБ',
      'hs-CRP',
      'hsCRP',
      'hs-СРБ',
    ],
    ['mg/L'],
  ),
  blood('rheumatoid_factor', ['Ревматоидный фактор', 'РФ', 'RF', 'Rheumatoid factor'], UNITS_PER_MILLILITER),
  blood(
    'aslo',
    ['Антистрептолизин-О', 'Антистрептолизин О', 'АСЛО', 'ASO', 'ASLO', 'Antistreptolysin O'],
    UNITS_PER_MILLILITER,
  ),
  blood('procalcitonin', ['Прокальцитонин', 'ПКТ', 'Procalcitonin'], NANOGRAMS),
  blood('interleukin_6', ['Интерлейкин-6', 'Интерлейкин 6', 'ИЛ-6', 'IL-6', 'Interleukin 6'], PICOGRAMS),
  blood('fibrinogen', ['Фибриноген', 'Fibrinogen'], ['g/L', 'mg/dL']),
  blood('prothrombin_time', ['Протромбиновое время', 'ПВ', 'PT', 'Prothrombin time'], SECONDS),
  blood('inr', ['МНО', 'INR', 'Международное нормализованное отношение'], NO_UNIT),
  blood('quick', ['Протромбин по Квику', 'Протромбин', 'Протромбиновый индекс по Квику', 'Quick'], PERCENT),
  blood('prothrombin_index', ['Протромбиновый индекс', 'ПТИ', 'PTI'], PERCENT),
  blood(
    'aptt',
    [
      'АЧТВ',
      'АПТВ',
      'Активированное частичное тромбопластиновое время',
      'Активированное парциальное тромбопластиновое время',
      'APTT',
      'aPTT',
    ],
    SECONDS,
  ),
  blood('thrombin_time', ['Тромбиновое время', 'ТВ', 'TT', 'Thrombin time'], SECONDS),
  blood('d_dimer', ['D-димер', 'Д-димер', 'D-dimer'], ['ng FEU/mL', 'ug FEU/mL', 'ng/mL', 'ug/mL']),
  blood(
    'antithrombin',
    ['Антитромбин III', 'Антитромбин 3', 'Антитромбин', 'AT III', 'AT-III', 'Antithrombin III'],
    PERCENT,
  ),
  blood('protein_c', ['Протеин C', 'Protein C'], PERCENT),
  blood('protein_s', ['Протеин S', 'Protein S'], PERCENT),
  blood('lupus_anticoagulant', ['Волчаночный антикоагулянт', 'Lupus anticoagulant'], NO_UNIT),

  // The thyroid.
  blood(
    'tsh',
    [
      'ТТГ',
      'Тиреотропный гормон',
      'Тиреотропин',
      'ТТГ ультрачувствительный',
      'ТТГ высокочувствительный',
      'ТТГ 3-го поколения',
      'TSH',
      'Thyroid stimulating hormone',
    ],
    MILLIUNITS_PER_LITER,
  ),
  blood(
    'free_t4',
    [
      'Т4 свободный',
      'Свободный Т4',
      'Т4 св',
      'Тироксин свободный',
      'Свободный тироксин',
      'FT4',
      'Free T4',
      'Free thyroxine',
    ],
    ['pmol/L', 'ng/dL'],
    { molarMass: MOLAR_MASS.thyroxine },
  ),
  blood(
    'total_t4',
    ['Т4 общий', 'Общий Т4', 'Тироксин общий', 'Общий тироксин', 'TT4', 'Total T4', 'T4 total'],
    ['nmol/L', 'ug/dL'],
    { molarMass: MOLAR_MASS.thyroxine },
  ),
  blood(
    'free_t3',
    [
      'Т3 свободный',
      'Свободный Т3',
      'Т3 св',
      'Трийодтиронин свободный',
      'Свободный трийодтиронин',
      'FT3',
      'Free T3',
      'Free triiodothyronine',
    ],
    ['pmol/L', 'pg/mL'],
    { molarMass: MOLAR_MASS.triiodothyronine },
  ),
  blood(
    'total_t3',
    ['Т3 общий', 'Общий Т3', 'Трийодтиронин общий', 'Общий трийодтиронин', 'TT3', 'Total T3', 'T3 total'],
    ['nmol/L', 'ng/mL', 'ng/dL'],
    { molarMass: MOLAR_MASS.triiodothyronine },
  ),
  blood(
    'anti_tpo',
    [
      'Антитела к тиреопероксидазе',
      'Антитела к тиреоидной пероксидазе',
      'Антитела к ТПО',
      'Анти-ТПО',
      'АТ-ТПО',
      'АТ к ТПО',
      'АТПО',
      'Антитела к микросомальной тиреопероксидазе',
      'Антитела к пероксидазе щитовидной железы',
      'Anti-TPO',
      'TPOAb',
    ],
    UNITS_PER_MILLILITER,
  ),
  blood(
    'anti_tg',
    ['Антитела к тиреоглобулину', 'Антитела к ТГ', 'Анти-ТГ', 'АТ-ТГ', 'АТ к ТГ', 'Anti-TG', 'TgAb'],
    UNITS_PER_MILLILITER,
  ),
  blood('thyroglobulin', ['Тиреоглобулин', 'ТГ', 'Tg', 'Thyroglobulin'], NANOGRAMS),
  blood(
    'trab',
    [
      'Антитела к рецепторам ТТГ',
      'Антитела к рецептору ТТГ',
      'Антитела к рецепторам тиреотропного гормона',
      'АТ к рецепторам ТТГ',
      'АТ-рТТГ',
      'Антитела к рТТГ',
      'TRAb',
    ],
    UNITS_PER_LITER,
  ),
  blood('calcitonin', ['Кальцитонин', 'Calcitonin'], PICOGRAMS),

  // Sex hormones and pregnancy.
  blood('lh', ['ЛГ', 'Лютеинизирующий гормон', 'Лютропин', 'LH', 'Luteinizing hormone'], UNITS_PER_LITER),
  blood(
    'fsh',
    ['ФСГ', 'Фолликулостимулирующий гормон', 'Фоллитропин', 'FSH', 'Follicle stimulating hormone'],
    UNITS_PER_LITER,
  ),
  blood('lh_fsh_ratio', ['ЛГ/ФСГ', 'Соотношение ЛГ/ФСГ', 'Отношение ЛГ/ФСГ', 'LH/FSH'], NO_UNIT),
  blood('prolactin', ['Пролактин', 'PRL', 'Prolactin'], ['ng/mL', 'mU/L']),
  blood('estradiol', ['Эстрадиол', 'E2', 'Estradiol'], ['pmol/L', 'pg/mL'], {
    molarMass: MOLAR_MASS.estradiol,
  }),
  blood('progesterone', ['Прогестерон', 'Progesterone'], ['nmol/L', 'ng/mL'], {
    molarMass: MOLAR_MASS.progesterone,
  }),
  blood(
    'hydroxyprogesterone',
    [
      '17-ОН-прогестерон',
      '17-ОН прогестерон',
      '17-гидроксипрогестерон',
      '17-альфа-гидроксипрогестерон',
      '17α-гидроксипрогестерон',
      '17-ОП',
      '17-OHP',
      '17-OH progesterone',
    ],
    ['nmol/L', 'ng/mL'],
    { molarMass: MOLAR_MASS.hydroxyprogesterone },
  ),
  blood(
    'testosterone',
    ['Тестостерон', 'Тестостерон общий', 'Общий тестостерон', 'Testosterone', 'Total testosterone'],
    ['nmol/L', 'ng/mL', 'ng/dL'],
    { molarMass: MOLAR_MASS.testosterone },
  ),
  blood(
    'free_testosterone',
    ['Тестостерон свободный', 'Свободный тестостерон', 'Free testosterone'],
    ['pg/mL', 'pmol/L', 'nmol/L'],
    { molarMass: MOLAR_MASS.testosterone },
  ),
  blood(
    'shbg',
    [
      'ГСПГ',
      'Глобулин, связывающий половые гормоны',
      'Секс-стероид-связывающий глобулин',
      'ССГ',
      'SHBG',
      'Sex hormone binding globulin',
    ],
    ['nmol/L'],
  ),
  blood(
    'free_androgen_index',
    ['Индекс свободных андрогенов', 'ИСА', 'FAI', 'Free androgen index'],
    ['%', null],
  ),
  blood(
    'dhea_s',
    [
      'ДГЭА-С',
      'ДГЭА-сульфат',
      'ДЭА-SO4',
      'ДГЭА-SO4',
      'ДЭА-С',
      'Дегидроэпиандростерон-сульфат',
      'Дегидроэпиандростерон сульфат',
      'DHEA-S',
      'DHEA-SO4',
      'DHEAS',
      'DHEA sulfate',
    ],
    ['umol/L', 'ug/dL', 'ug/mL'],
    { molarMass: MOLAR_MASS.dheaSulfate },
  ),
  blood('dhea', ['ДГЭА', 'Дегидроэпиандростерон', 'DHEA'], ['nmol/L', 'ng/mL'], {
    molarMass: MOLAR_MASS.dhea,
  }),
  blood('androstenedione', ['Андростендион', 'Androstenedione'], ['ng/mL', 'nmol/L'], {
    molarMass: MOLAR_MASS.androstenedione,
  }),
  blood(
    'dihydrotestosterone',
    ['Дигидротестостерон', 'ДГТ', 'DHT', 'Dihydrotestosterone'],
    ['pg/mL', 'nmol/L'],
    {
      molarMass: MOLAR_MASS.dihydrotestosterone,
    },
  ),
  blood(
    'amh',
    ['АМГ', 'Антимюллеров гормон', 'Антимюллеровский гормон', 'Мюллерова ингибирующая субстанция', 'AMH'],
    ['ng/mL', 'pmol/L'],
    { molarMass: MOLAR_MASS.antiMullerianHormone },
  ),
  blood('inhibin_b', ['Ингибин B', 'Inhibin B'], PICOGRAMS),
  blood(
    'hcg',
    [
      'ХГЧ',
      'ХГЧ общий',
      'Хорионический гонадотропин',
      'Хорионический гонадотропин человека',
      'Бета-ХГЧ',
      'β-ХГЧ',
      'Общий бета-ХГЧ',
      'Бета-субъединица ХГЧ',
      'hCG',
      'β-hCG',
      'Beta-hCG',
    ],
    UNITS_PER_LITER,
  ),
  blood(
    'free_beta_hcg',
    [
      'Свободная бета-субъединица ХГЧ',
      'Свободная β-субъединица ХГЧ',
      'Свободный бета-ХГЧ',
      'Свободный β-ХГЧ',
      'Free beta-hCG',
    ],
    ['ng/mL', 'U/L'],
  ),
  blood(
    'papp_a',
    [
      'PAPP-A',
      'Ассоциированный с беременностью протеин-А плазмы',
      'Протеин А, ассоциированный с беременностью',
    ],
    UNITS_PER_LITER,
  ),
  blood(
    'free_estriol',
    ['Эстриол свободный', 'Свободный эстриол', 'Неконъюгированный эстриол', 'Free estriol', 'uE3'],
    ['nmol/L', 'ng/mL'],
    { molarMass: MOLAR_MASS.estriol },
  ),

  // Adrenal and pituitary glands, bones.
  blood('cortisol', ['Кортизол', 'Гидрокортизон', 'Cortisol'], ['nmol/L', 'ug/dL'], {
    molarMass: MOLAR_MASS.cortisol,
  }),
  blood('acth', ['АКТГ', 'Адренокортикотропный гормон', 'Кортикотропин', 'ACTH'], ['pg/mL', 'pmol/L'], {
    molarMass: MOLAR_MASS.acth,
  }),
  blood('aldosterone', ['Альдостерон', 'Aldosterone'], ['pg/mL', 'pmol/L', 'ng/dL'], {
    molarMass: MOLAR_MASS.aldosterone,
  }),
  blood('renin', ['Ренин', 'Ренин прямой', 'Прямой ренин', 'Renin', 'Direct renin'], ['mU/L', 'pg/mL']),
  blood(
    'aldosterone_renin_ratio',
    ['Альдостерон-рениновое соотношение', 'Альдостерон/ренин', 'АРС', 'ARR'],
    NO_UNIT,
  ),
  blood(
    'growth_hormone',
    ['Соматотропный гормон', 'СТГ', 'Гормон роста', 'Соматотропин', 'GH', 'hGH', 'Growth hormone'],
    ['ng/mL', 'mU/L'],
  ),
  blood(
    'igf1',
    [
      'ИФР-1',
      'Инсулиноподобный фактор роста 1',
      'Инсулиноподобный фактор роста-1',
      'Соматомедин С',
      'IGF-1',
      'IGF-I',
    ],
    NANOGRAMS,
  ),
  blood(
    'pth',
    [
      'Паратгормон',
      'Паратгормон интактный',
      'Интактный паратгормон',
      'Паратиреоидный гормон',
      'Паратиреоидный гормон интактный',
      'ПТГ',
      'PTH',
      'Intact PTH',
    ],
    ['pg/mL', 'pmol/L'],
    { molarMass: MOLAR_MASS.parathyroidHormone },
  ),
  blood('osteocalcin', ['Остеокальцин', 'N-MID остеокальцин', 'N-MID Osteocalcin', 'Osteocalcin'], NANOGRAMS),
  blood(
    'beta_crosslaps',
    [
      'Бета-CrossLaps',
      'β-CrossLaps',
      'Бета-кросслапс',
      'CrossLaps',
      'С-концевые телопептиды коллагена I типа',
      'β-CTx',
      'CTX',
    ],
    ['ng/mL', 'pg/mL'],
  ),
  blood(
    'p1np',
    [
      'P1NP',
      'PINP',
      'Total P1NP',
      'N-терминальный пропептид проколлагена 1 типа',
      'Общий N-терминальный пропептид проколлагена 1 типа',
    ],
    NANOGRAMS,
  ),
  blood(
    'vitamin_d',
    [
      'Витамин D',
      'Витамин Д',
      'Витамин D общий',
      'Витамин D суммарный',
      '25-OH витамин D',
      '25-OH витамин D суммарный',
      '25-ОН витамин Д',
      'Витамин D 25-OH',
      'Витамин D 25-гидрокси',
      '25-гидроксивитамин D',
      '25-гидроксикальциферол',
      '25-гидроксихолекальциферол',
      '25(OH)D',
      '25-OH',
      '25-OH-D',
      'Кальцидиол',
      'Vitamin D',
      '25-OH vitamin D',
      '25-hydroxyvitamin D',
    ],
    ['ng/mL', 'nmol/L'],
    { molarMass: MOLAR_MASS.calcidiol },
  ),
  blood(
    'calcitriol',
    [
      '1,25-дигидроксивитамин D',
      '1,25-дигидроксихолекальциферол',
      '1,25(OH)2D',
      '1,25-(OH)2 витамин D',
      '1,25-OH витамин D',
      'Витамин D 1,25-дигидрокси',
      'Кальцитриол',
    ],
    ['pg/mL', 'pmol/L'],
    { molarMass: MOLAR_MASS.calcitriol },
  ),

  // Vitamins.
  blood(
    'vitamin_b12',
    ['Витамин B12', 'B12', 'Цианокобаламин', 'Кобаламин', 'Vitamin B12', 'Cobalamin'],
    ['pg/mL', 'pmol/L'],
    { molarMass: MOLAR_MASS.cobalamin },
  ),
  blood(
    'active_b12',
    ['Активный витамин B12', 'Активный B12', 'Холотранскобаламин', 'Holotranscobalamin'],
    ['pmol/L'],
  ),
  blood(
    'folate',
    [
      'Фолиевая кислота',
      'Фолиевая кислота в сыворотке',
      'Фолаты',
      'Фолат',
      'Витамин B9',
      'Folate',
      'Folic acid',
    ],
    ['ng/mL', 'nmol/L'],
    { molarMass: MOLAR_MASS.folicAcid },
  ),
  blood('vitamin_a', ['Витамин A', 'Ретинол', 'Vitamin A', 'Retinol'], ['ug/mL', 'umol/L'], {
    molarMass: MOLAR_MASS.retinol,
  }),
  blood(
    'vitamin_e',
    ['Витамин E', 'Токоферол', 'Альфа-токоферол', 'α-токоферол', 'Vitamin E', 'Tocopherol'],
    ['ug/mL', 'umol/L'],
    { molarMass: MOLAR_MASS.tocopherol },
  ),
  blood(
    'vitamin_c',
    ['Витамин C', 'Аскорбиновая кислота', 'Vitamin C', 'Ascorbic acid'],
    ['ug/mL', 'mg/dL', 'umol/L'],
    { molarMass: MOLAR_MASS.ascorbicAcid },
  ),
  blood('vitamin_b1', ['Витамин B1', 'Тиамин', 'Vitamin B1', 'Thiamine'], ['ng/mL', 'nmol/L']),
  blood(
    'vitamin_b6',
    ['Витамин B6', 'Пиридоксин', 'Пиридоксаль-5-фосфат', 'Vitamin B6'],
    ['ng/mL', 'nmol/L'],
  ),
  blood('vitamin_k', ['Витамин K', 'Витамин K1', 'Филлохинон', 'Vitamin K'], NANOGRAMS),

  // The heart and muscles.
  blood(
    'troponin_i',
    ['Тропонин I', 'Тропонин I высокочувствительный', 'Troponin I', 'hs-Troponin I', 'cTnI', 'hs-cTnI'],
    ['ng/mL', 'pg/mL'],
  ),
  blood(
    'troponin_t',
    ['Тропонин T', 'Тропонин T высокочувствительный', 'Troponin T', 'cTnT', 'hs-cTnT'],
    ['ng/mL', 'pg/mL'],
  ),
  blood(
    'nt_probnp',
    [
      'NT-proBNP',
      'NT-проBNP',
      'N-концевой фрагмент мозгового натрийуретического пропептида',
      'N-терминальный фрагмент натрийуретического пропептида B-типа',
      'N-терминальный пропептид натрийуретического гормона B-типа',
    ],
    PICOGRAMS,
  ),
  blood(
    'bnp',
    [
      'BNP',
      'Мозговой натрийуретический пептид',
      'Натрийуретический пептид B-типа',
      'Brain natriuretic peptide',
    ],
    PICOGRAMS,
  ),
  blood('myoglobin', ['Миоглобин', 'Myoglobin'], NANOGRAMS),
  blood('eosinophil_cationic_protein', ['Эозинофильный катионный белок', 'ECP'], NANOGRAMS),

  // Immunity and autoimmunity.
  blood(
    'ige_total',
    ['Иммуноглобулин E общий', 'Иммуноглобулин E', 'IgE общий', 'Общий IgE', 'IgE', 'Total IgE', 'IgE total'],
    UNITS_PER_MILLILITER,
  ),
  blood(
    'iga',
    ['Иммуноглобулин A', 'Иммуноглобулин A общий', 'IgA', 'Ig A', 'IgA общий', 'Immunoglobulin A'],
    ['g/L', 'mg/dL'],
  ),
  blood(
    'igm',
    ['Иммуноглобулин M', 'Иммуноглобулин M общий', 'IgM', 'Ig M', 'IgM общий', 'Immunoglobulin M'],
    ['g/L', 'mg/dL'],
  ),
  blood(
    'igg',
    ['Иммуноглобулин G', 'Иммуноглобулин G общий', 'IgG', 'Ig G', 'IgG общий', 'Immunoglobulin G'],
    ['g/L', 'mg/dL'],
  ),
  blood('igg4', ['IgG4', 'Иммуноглобулин G4', 'Подкласс IgG4'], ['g/L', 'mg/dL']),
  blood(
    'complement_c3',
    ['Комплемент C3', 'C3 компонент комплемента', 'Компонент комплемента C3', 'C3', 'Complement C3'],
    ['g/L', 'mg/dL'],
  ),
  blood(
    'complement_c4',
    ['Комплемент C4', 'C4 компонент комплемента', 'Компонент комплемента C4', 'C4', 'Complement C4'],
    ['g/L', 'mg/dL'],
  ),
  blood(
    'anti_dsdna',
    [
      'Антитела к двуспиральной ДНК',
      'Антитела к двухспиральной ДНК',
      'Антитела к нативной ДНК',
      'Антитела к дсДНК',
      'АТ к дсДНК',
      'Анти-дсДНК',
      'Anti-dsDNA',
    ],
    UNITS_PER_MILLILITER,
  ),
  blood(
    'anti_ccp',
    [
      'Антитела к циклическому цитруллинированному пептиду',
      'Антитела к циклическому цитруллиновому пептиду',
      'Антитела к ЦЦП',
      'АТ к ЦЦП',
      'Анти-ЦЦП',
      'АЦЦП',
      'Anti-CCP',
    ],
    UNITS_PER_MILLILITER,
  ),
  blood(
    'anti_mcv',
    ['Антитела к модифицированному цитруллинированному виментину', 'Антитела к МЦВ', 'АМЦВ', 'Anti-MCV'],
    UNITS_PER_MILLILITER,
  ),
  blood(
    'antinuclear_factor',
    ['Антинуклеарный фактор', 'АНФ', 'Антинуклеарные антитела', 'ANA'],
    [null, 'index'],
    { words: true },
  ),
  ...(['IgA', 'IgG'] as const).map((cls) =>
    blood(
      `ttg_${cls.toLowerCase()}`,
      [
        `Антитела к тканевой трансглутаминазе ${cls}`,
        `Антитела класса ${cls} к тканевой трансглутаминазе`,
        `${cls} к тканевой трансглутаминазе`,
        `Антитела к тТГ ${cls}`,
        `Анти-тТГ ${cls}`,
        `Anti-tTG ${cls}`,
        `tTG ${cls}`,
      ],
      [null, 'U/mL'],
      { words: true },
    ),
  ),

  // Tumor markers.
  blood(
    'psa_total',
    [
      'ПСА',
      'ПСА общий',
      'Общий ПСА',
      'ПСА общ',
      'Простатспецифический антиген',
      'Простатспецифический антиген общий',
      'Простат-специфический антиген общий',
      'Простатический специфический антиген общий',
      'PSA',
      'PSA total',
      'Total PSA',
      'tPSA',
    ],
    NANOGRAMS,
  ),
  blood(
    'psa_free',
    [
      'ПСА свободный',
      'Свободный ПСА',
      'ПСА своб',
      'Простатспецифический антиген свободный',
      'Простат-специфический антиген свободный',
      'Free PSA',
      'PSA free',
      'fPSA',
    ],
    NANOGRAMS,
  ),
  blood(
    'psa_ratio',
    [
      'ПСА свободный/ПСА общий',
      'Отношение свободного ПСА к общему',
      'Соотношение ПСА свободный/общий',
      'Отношение ПСА свободный/общий',
      'Индекс ПСА',
      'fPSA/tPSA',
    ],
    PERCENT,
  ),
  blood('cea', ['РЭА', 'Раковый эмбриональный антиген', 'Раково-эмбриональный антиген', 'CEA'], NANOGRAMS),
  ...(['125', '15-3', '19-9', '72-4', '242'] as const).map((n) =>
    blood(
      `ca_${n.replace('-', '_')}`,
      [`СА ${n}`, `CA ${n}`, `Онкомаркер СА ${n}`, `Раковый антиген ${n}`, `Антиген CA ${n}`],
      UNITS_PER_MILLILITER,
    ),
  ),
  blood('afp', ['АФП', 'Альфа-фетопротеин', 'α-фетопротеин', 'AFP', 'Alpha-fetoprotein'], ['U/mL', 'ng/mL']),
  blood(
    'he4',
    [
      'HE4',
      'Человеческий эпидидимальный белок 4',
      'Эпидидимальный секреторный белок 4',
      'Секреторный белок эпидидимиса человека 4',
    ],
    ['pmol/L'],
  ),
  blood('roma', ['ROMA', 'Индекс ROMA', 'ROMA индекс'], PERCENT),
  blood('cyfra_21_1', ['CYFRA 21-1', 'Цифра 21-1', 'Фрагмент цитокератина 19'], NANOGRAMS),
  blood('nse', ['НСЕ', 'Нейронспецифическая енолаза', 'Нейрон-специфическая енолаза', 'NSE'], NANOGRAMS),
  blood(
    'scc',
    ['SCC', 'SCCA', 'Антиген плоскоклеточной карциномы', 'Антиген плоскоклеточного рака'],
    NANOGRAMS,
  ),
  blood('chromogranin_a', ['Хромогранин A', 'Chromogranin A'], NANOGRAMS),

  // Other blood tests.
  blood('erythropoietin', ['Эритропоэтин', 'EPO', 'Erythropoietin'], UNITS_PER_LITER),
  blood('leptin', ['Лептин', 'Leptin'], NANOGRAMS),
  blood('serotonin', ['Серотонин', 'Serotonin'], NANOGRAMS),
  blood('pepsinogen_1', ['Пепсиноген I', 'Пепсиноген 1', 'Pepsinogen I'], NANOGRAMS),
  blood('pepsinogen_2', ['Пепсиноген II', 'Пепсиноген 2', 'Pepsinogen II'], NANOGRAMS),
  blood(
    'pepsinogen_ratio',
    ['Пепсиноген I/Пепсиноген II', 'Пепсиноген I/II', 'Соотношение пепсиноген I/II'],
    NO_UNIT,
  ),
  blood('gastrin_17', ['Гастрин-17', 'Гастрин 17', 'Gastrin-17'], ['pmol/L']),

  // Infections.
  blood(
    'hbsag',
    [
      'HBsAg',
      'HBs-антиген',
      'Антиген HBs',
      'Поверхностный антиген вируса гепатита B',
      'Австралийский антиген',
      'HBsAg качественный',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood(
    'anti_hbs',
    [
      'Антитела к HBsAg',
      'Антитела к HBs-антигену',
      'Анти-HBs',
      'Анти-HBsAg',
      'Anti-HBs',
      'Антитела к поверхностному антигену вируса гепатита B',
    ],
    [null, 'U/L'],
    { words: true },
  ),
  blood(
    'anti_hbc',
    [
      'Анти-HBc',
      'Анти-HBc суммарные',
      'Anti-HBc',
      'Anti-HBc total',
      'Антитела к HBcAg',
      'Антитела к HBcAg суммарные',
      'Антитела к HBc-антигену суммарные',
      'Антитела к ядерному антигену вируса гепатита B',
      'Anti-HBcor',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood('hbeag', ['HBeAg', 'HBe-антиген', 'Антиген HBe', 'Антиген HBe вируса гепатита B'], SEROLOGY, {
    words: true,
  }),
  blood(
    'anti_hbe',
    [
      'Anti-HBe',
      'Анти-HBe',
      'Антитела к HBeAg',
      'Антитела к HBe-антигену',
      'Антитела к HBe-антигену вируса гепатита B',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood('anti_hdv', ['Anti-HDV', 'Анти-HDV', 'Антитела к вирусу гепатита D', 'Антитела к HDV'], SEROLOGY, {
    words: true,
  }),
  blood(
    'anti_hcv',
    [
      'Антитела к HCV',
      'Антитела к HCV суммарные',
      'Антитела к вирусу гепатита C',
      'Антитела к вирусу гепатита C суммарные',
      'Анти-HCV',
      'Анти-HCV суммарные',
      'Anti-HCV',
      'Anti-HCV total',
      'HCV антитела',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood(
    'hiv',
    [
      'ВИЧ',
      'ВИЧ 1/2',
      'Антитела к ВИЧ',
      'Антитела к ВИЧ 1/2',
      'Антитела к ВИЧ 1/2 и антиген p24',
      'Антитела к ВИЧ 1 и 2 типов и антиген p24',
      'ВИЧ 1/2 антитела и антиген p24',
      'Антиген/антитела к ВИЧ 1/2',
      'ВИЧ Ag/Ab',
      'HIV Ag/Ab',
      'HIV 1/2',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood(
    'syphilis',
    [
      'Сифилис',
      'Сифилис суммарные антитела',
      'Антитела к Treponema pallidum',
      'Антитела к Treponema pallidum суммарные',
      'Treponema pallidum антитела суммарные',
      'Антитела к бледной трепонеме',
      'Антитела к бледной трепонеме суммарные',
      'Антитела к возбудителю сифилиса',
      'Антитела к возбудителю сифилиса суммарные',
      'Anti-TP',
    ],
    SEROLOGY,
    { words: true },
  ),
  blood(
    'rpr',
    ['RPR', 'Микрореакция преципитации', 'Реакция микропреципитации', 'RW', 'Реакция Вассермана'],
    [null, 'index'],
    { words: true },
  ),
  ...antibodies(
    'cmv',
    {
      names: ['ЦМВ', 'Цитомегаловирус', 'CMV', 'Cytomegalovirus'],
      to: ['ЦМВ', 'цитомегаловирусу', 'CMV', 'Cytomegalovirus'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'toxoplasma',
    {
      names: ['Токсоплазма', 'Токсоплазмоз', 'Toxoplasma', 'Toxoplasma gondii'],
      to: ['токсоплазме', 'токсоплазмам', 'Toxoplasma gondii', 'токсоплазме (Toxoplasma gondii)'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'rubella',
    {
      names: ['Краснуха', 'Вирус краснухи', 'Rubella'],
      to: ['вирусу краснухи', 'краснухе', 'возбудителю краснухи', 'Rubella'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'hsv',
    {
      names: [
        'ВПГ 1/2',
        'Вирус простого герпеса 1 и 2 типов',
        'Вирус простого герпеса 1/2',
        'Герпес 1/2',
        'HSV 1/2',
      ],
      to: [
        'ВПГ 1/2',
        'вирусу простого герпеса 1 и 2 типов',
        'вирусу простого герпеса 1, 2 типов',
        'вирусу простого герпеса 1/2',
        'HSV 1/2',
      ],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'measles',
    { names: ['Корь', 'Вирус кори', 'Measles'], to: ['вирусу кори', 'кори', 'Measles'] },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'mumps',
    {
      names: ['Паротит', 'Эпидемический паротит', 'Mumps'],
      to: ['вирусу эпидемического паротита', 'эпидемическому паротиту', 'Mumps'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'varicella',
    {
      names: ['Ветряная оспа', 'Varicella zoster', 'VZV'],
      to: ['вирусу ветряной оспы', 'вирусу Варицелла-Зостер', 'Varicella zoster', 'VZV'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'hepatitis_a',
    { names: ['Гепатит A', 'HAV', 'Anti-HAV'], to: ['вирусу гепатита A', 'HAV'] },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'h_pylori',
    {
      names: ['Helicobacter pylori', 'Хеликобактер пилори', 'H. pylori'],
      to: ['Helicobacter pylori', 'хеликобактер пилори', 'H. pylori'],
    },
    ['IgG', 'IgA', 'IgM'],
  ),
  ...antibodies(
    'chlamydia_trachomatis',
    {
      names: ['Chlamydia trachomatis', 'Хламидия трахоматис'],
      to: ['Chlamydia trachomatis', 'хламидии трахоматис', 'хламидии (Chlamydia trachomatis)'],
    },
    ['IgG', 'IgA', 'IgM'],
  ),
  ...antibodies(
    'mycoplasma_pneumoniae',
    {
      names: ['Mycoplasma pneumoniae'],
      to: ['Mycoplasma pneumoniae', 'микоплазме пневмонии', 'микоплазме (Mycoplasma pneumoniae)'],
    },
    ['IgG', 'IgA', 'IgM'],
  ),
  ...antibodies(
    'mycoplasma_hominis',
    { names: ['Mycoplasma hominis'], to: ['Mycoplasma hominis', 'микоплазме (Mycoplasma hominis)'] },
    ['IgG', 'IgA', 'IgM'],
  ),
  ...antibodies(
    'chlamydophila_pneumoniae',
    {
      names: ['Chlamydia pneumoniae', 'Chlamydophila pneumoniae'],
      to: ['Chlamydia pneumoniae', 'Chlamydophila pneumoniae', 'хламидофиле (Chlamydophila pneumoniae)'],
    },
    ['IgG', 'IgA', 'IgM'],
  ),
  ...antibodies(
    'coxsackie',
    {
      names: ['Coxsackievirus', 'Вирус Коксаки', 'Коксаки'],
      to: ['Coxsackievirus', 'вирусу Коксаки', 'вирусу Коксаки (Coxsackievirus)'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'opisthorchis',
    {
      names: ['Описторхи', 'Описторхоз', 'Opisthorchis felineus'],
      to: ['описторхам', 'Opisthorchis felineus', 'описторхам (Opisthorchis felineus)'],
    },
    ['IgG', 'IgM'],
  ),
  ...antibodies(
    'toxocara',
    {
      names: ['Токсокары', 'Токсокароз', 'Toxocara canis'],
      to: ['токсокарам', 'Toxocara canis', 'токсокарам (Toxocara canis)'],
    },
    ['IgG'],
  ),
  ...antibodies(
    'echinococcus',
    {
      names: ['Эхинококк', 'Эхинококкоз', 'Echinococcus granulosus'],
      to: ['эхинококку', 'эхинококкам', 'Echinococcus granulosus', 'эхинококкам (Echinococcus granulosus)'],
    },
    ['IgG'],
  ),
  ...antibodies(
    'ascaris',
    {
      names: ['Аскариды', 'Аскаридоз', 'Ascaris lumbricoides'],
      to: ['аскаридам', 'Ascaris lumbricoides', 'аскаридам (Ascaris lumbricoides)'],
    },
    ['IgG'],
  ),
  ...antibodies(
    'lamblia',
    {
      names: ['Лямблии', 'Лямблиоз', 'Giardia lamblia', 'Lamblia intestinalis'],
      to: ['лямблиям', 'Giardia lamblia', 'лямблиям (Lamblia intestinalis)'],
    },
    ['суммарные'],
  ),
  ...antibodies(
    'sars_cov_2',
    {
      names: ['SARS-CoV-2', 'COVID-19', 'Коронавирус SARS-CoV-2'],
      to: ['SARS-CoV-2', 'коронавирусу SARS-CoV-2', 'COVID-19'],
    },
    ['IgG', 'IgM'],
    [null, 'BAU/mL', 'KP', 'index', 'U/mL'],
  ),
  epsteinBarr('ebv_vca_igm', CAPSID, 'IgM'),
  epsteinBarr('ebv_vca_igg', CAPSID, 'IgG'),
  epsteinBarr('ebv_ebna_igg', NUCLEAR, 'IgG'),
  epsteinBarr('ebv_ea_igg', EARLY, 'IgG'),

  // Blood groups.
  blood(
    'blood_group',
    [
      'Группа крови',
      'Группа крови по системе AB0',
      'Группа крови AB0',
      'Группа крови ABO',
      'Blood group',
      'AB0',
    ],
    NO_NUMBERS,
    { words: true },
  ),
  blood(
    'rh_factor',
    ['Резус-фактор', 'Резус-принадлежность', 'Резус', 'Rh-фактор', 'Rh', 'Rh(D)', 'Антиген D системы Резус'],
    NO_NUMBERS,
    { words: true },
  ),
  blood('kell', ['Kell', 'Антиген Kell', 'Kell-антиген', 'Антиген K системы Kell'], NO_NUMBERS, {
    words: true,
  }),
  blood(
    'rh_phenotype',
    [
      'Фенотип Rh',
      'Резус-фенотип',
      'Фенотип антигенов системы Резус',
      'Фенотипирование по антигенам C, c, E, e',
    ],
    NO_NUMBERS,
    { words: true },
  ),
  blood(
    'irregular_antibodies',
    [
      'Антиэритроцитарные антитела',
      'Нерегулярные антиэритроцитарные антитела',
      'Аллоиммунные антитела',
      'Антитела к антигенам эритроцитов',
    ],
    NO_NUMBERS,
    { words: true },
  ),

  // Urine.
  urine(
    'urine_specific_gravity',
    [
      'Удельный вес',
      'Удельный вес мочи',
      'Относительная плотность',
      'Относительная плотность мочи',
      'Плотность мочи',
      'Specific gravity',
    ],
    [null, 'g/mL'],
  ),
  urine('urine_color', ['Цвет', 'Цвет мочи'], NO_NUMBERS, IN_CONTEXT),
  urine('urine_clarity', ['Прозрачность', 'Прозрачность мочи', 'Мутность'], NO_NUMBERS, IN_CONTEXT),
  urine(
    'urine_ph',
    ['pH', 'pH мочи', 'Реакция', 'Реакция pH', 'Реакция мочи', 'Реакция мочи pH'],
    NO_UNIT,
    IN_CONTEXT,
  ),
  urine(
    'urine_protein',
    ['Белок', 'Белок в моче', 'Белок мочи', 'Общий белок в моче', 'Белок общий в моче', 'Протеинурия', 'PRO'],
    ['g/L', 'mg/dL'],
    IN_CONTEXT,
  ),
  urine(
    'urine_glucose',
    ['Глюкоза', 'Глюкоза в моче', 'Глюкоза мочи', 'Сахар в моче'],
    ['mmol/L', 'mg/dL'],
    IN_CONTEXT,
  ),
  urine(
    'urine_ketones',
    ['Кетоновые тела', 'Кетоновые тела в моче', 'Кетоны', 'Ацетон', 'Ацетон в моче', 'KET', 'Ketones'],
    ['mmol/L', 'mg/dL'],
    { words: true },
  ),
  urine(
    'urine_bilirubin',
    ['Билирубин', 'Билирубин в моче', 'Билирубин мочи', 'BIL'],
    BILIRUBIN_UNITS,
    IN_CONTEXT,
  ),
  urine(
    'urobilinogen',
    ['Уробилиноген', 'Уробилиноген в моче', 'Уробилиноиды', 'UBG', 'URO', 'Urobilinogen'],
    ['umol/L', 'mg/dL'],
    { words: true },
  ),
  urine('nitrites', ['Нитриты', 'Нитриты в моче', 'NIT', 'Nitrite'], NO_NUMBERS, { words: true }),
  // A sediment is counted per microliter or per field of view, in words; a count per milliliter
  // (Нечипоренко) is another analysis.
  urine(
    'urine_leukocytes',
    ['Лейкоциты', 'Лейкоциты в моче', 'Лейкоциты мочи', 'LEU', 'WBC'],
    PER_MICROLITER,
    IN_CONTEXT,
  ),
  urine(
    'urine_erythrocytes',
    ['Эритроциты', 'Эритроциты в моче', 'Эритроциты мочи', 'ERY', 'RBC'],
    PER_MICROLITER,
    IN_CONTEXT,
  ),
  urine(
    'urine_hyaline_casts',
    ['Цилиндры гиалиновые', 'Гиалиновые цилиндры', 'Цилиндры', 'Цилиндры в моче'],
    PER_MICROLITER,
    { words: true },
  ),
  urine('urine_pathological_casts', ['Цилиндры патологические', 'Патологические цилиндры'], PER_MICROLITER, {
    words: true,
  }),
  urine('urine_granular_casts', ['Цилиндры зернистые', 'Зернистые цилиндры'], PER_MICROLITER, {
    words: true,
  }),
  urine('urine_squamous_epithelium', ['Эпителий плоский', 'Плоский эпителий'], PER_MICROLITER, IN_CONTEXT),
  urine(
    'urine_nonsquamous_epithelium',
    [
      'Эпителий неплоский',
      'Неплоский эпителий',
      'Эпителий переходный',
      'Переходный эпителий',
      'Эпителий переходный и почечный',
    ],
    PER_MICROLITER,
    IN_CONTEXT,
  ),
  urine('urine_bacteria', ['Бактерии', 'Бактерии в моче'], PER_MICROLITER, IN_CONTEXT),
  urine(
    'urine_yeast',
    ['Дрожжевые грибы', 'Дрожжеподобные грибы', 'Дрожжевые клетки'],
    PER_MICROLITER,
    IN_CONTEXT,
  ),
  urine('urine_mucus', ['Слизь', 'Слизь в моче'], PER_MICROLITER, IN_CONTEXT),
  urine('urine_salts', ['Соли', 'Кристаллы', 'Соли в моче'], PER_MICROLITER, IN_CONTEXT),
  urine(
    'microalbumin',
    [
      'Микроальбумин',
      'Микроальбумин в моче',
      'Альбумин в моче',
      'Альбумин мочи',
      'Альбумин в разовой порции мочи',
      'Microalbumin',
    ],
    ['mg/L', 'mg/dL'],
  ),
  urine(
    'albumin_creatinine_ratio',
    [
      'Альбумин/креатинин',
      'Соотношение альбумин/креатинин',
      'Отношение альбумин/креатинин',
      'Альбумин-креатининовое соотношение',
      'Альбумин/креатининовое соотношение',
      'Индекс альбумин/креатинин',
      'Микроальбумин/креатинин',
      'Соотношение микроальбумин/креатинин',
      'ACR',
    ],
    ['mg/mmol', 'mg/g'],
  ),
  urine(
    'urine_creatinine',
    ['Креатинин в моче', 'Креатинин мочи', 'Креатинин в разовой порции мочи'],
    ['umol/L', 'mmol/L', 'mg/dL'],
    { molarMass: MOLAR_MASS.creatinine },
  ),
  urine(
    'protein_creatinine_ratio',
    ['Белок/креатинин', 'Соотношение белок/креатинин', 'Отношение белок/креатинин', 'Индекс белок/креатинин'],
    ['mg/mmol', 'mg/g'],
  ),
  urine(
    'daily_protein',
    ['Белок в суточной моче', 'Белок общий в суточной моче', 'Суточная протеинурия', 'Суточная потеря белка'],
    ['g/d'],
  ),
  urine('urine_calcium', ['Кальций в моче', 'Кальций мочи', 'Кальций в разовой порции мочи'], MMOL, {
    molarMass: MOLAR_MASS.calcium,
  }),
  urine('daily_calcium', ['Кальций в суточной моче', 'Кальций суточная моча'], ['mmol/d']),
  urine(
    'urine_amylase',
    ['Амилаза в моче', 'Амилаза мочи', 'Альфа-амилаза в моче', 'Диастаза', 'Диастаза мочи'],
    UNITS_PER_LITER,
  ),

  // Stool: a coprogram's findings, then the tests of stool.
  stool('stool_color', ['Цвет', 'Цвет кала'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_consistency', ['Консистенция'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_ph', ['pH', 'Реакция', 'Реакция pH'], NO_UNIT, IN_CONTEXT),
  stool('stool_mucus', ['Слизь'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_leukocytes', ['Лейкоциты'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_erythrocytes', ['Эритроциты'], NO_NUMBERS, IN_CONTEXT),
  stool(
    'stool_striated_muscle_fibers',
    ['Мышечные волокна с исчерченностью', 'Мышечные волокна переваренные'],
    NO_NUMBERS,
    IN_CONTEXT,
  ),
  stool(
    'stool_unstriated_muscle_fibers',
    ['Мышечные волокна без исчерченности', 'Мышечные волокна непереваренные'],
    NO_NUMBERS,
    IN_CONTEXT,
  ),
  stool('stool_connective_tissue', ['Соединительная ткань'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_neutral_fat', ['Нейтральный жир'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_fatty_acids', ['Жирные кислоты'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_soaps', ['Соли жирных кислот', 'Мыла', 'Соли жирных кислот мыла'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_digestible_fiber', ['Переваримая клетчатка', 'Клетчатка переваримая'], NO_NUMBERS, IN_CONTEXT),
  stool(
    'stool_intracellular_starch',
    ['Крахмал внутриклеточный', 'Внутриклеточный крахмал'],
    NO_NUMBERS,
    IN_CONTEXT,
  ),
  stool(
    'stool_extracellular_starch',
    ['Крахмал внеклеточный', 'Внеклеточный крахмал'],
    NO_NUMBERS,
    IN_CONTEXT,
  ),
  stool(
    'stool_iodophilic_flora',
    ['Йодофильная флора', 'Йодофильная флора нормальная', 'Йодофильная флора патологическая'],
    NO_NUMBERS,
    IN_CONTEXT,
  ),
  stool('stool_yeast', ['Дрожжевые грибы', 'Дрожжеподобные грибы'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_protozoa', ['Простейшие', 'Цисты простейших'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_helminth_eggs', ['Яйца гельминтов', 'Яйца глистов'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_stercobilin', ['Реакция на стеркобилин', 'Стеркобилин'], NO_NUMBERS, IN_CONTEXT),
  stool('stool_bilirubin', ['Реакция на билирубин'], NO_NUMBERS, IN_CONTEXT),
  stool(
    'calprotectin',
    [
      'Кальпротектин',
      'Кальпротектин в кале',
      'Кальпротектин фекальный',
      'Фекальный кальпротектин',
      'Calprotectin',
    ],
    ['ug/g'],
  ),
  stool(
    'occult_blood',
    [
      'Скрытая кровь',
      'Скрытая кровь в кале',
      'Кал на скрытую кровь',
      'Тест на скрытую кровь',
      'Иммунохимический тест на скрытую кровь',
      'Гемоглобин в кале',
    ],
    [null, 'ng/mL', 'ug/g'],
    { words: true },
  ),
  stool(
    'pancreatic_elastase',
    [
      'Панкреатическая эластаза',
      'Панкреатическая эластаза 1',
      'Эластаза панкреатическая',
      'Эластаза-1',
      'Эластаза-1 в кале',
      'Pancreatic elastase',
    ],
    ['ug/g'],
  ),
]
