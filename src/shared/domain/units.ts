/**
 * Units of measurement: the built-in dictionary, how printed spellings map onto it, and how values
 * convert between units. A unit belongs to a dimension and has a scale to that dimension's base,
 * so conversions inside a dimension follow from the table (г/л ↔ мг/дл, 10⁹/л ↔ тыс/мкл). Molar
 * and mass concentrations convert through an analyte's molar mass; anything else needs an
 * explicit factor on the analyte.
 */

import { foldCase } from './text'

export interface BuiltinUnit {
  code: string
  display: string
  dimension: string
  /** Size of the unit in the base of its dimension (mass concentration base is g/L). */
  scale: number
  /** How labs and people write it; matched after normalizeUnitSpelling. */
  spellings: readonly string[]
}

const MASS_CONC = 'mass_conc' // base g/L
const MOLAR_CONC = 'molar_conc' // base mol/L
const COUNT_CONC = 'count_conc' // base 1/L
const ACTIVITY_CONC = 'activity_conc' // base U/L; IU and U are used interchangeably by labs
const FRACTION = 'fraction' // base 1

export const BUILTIN_UNITS: readonly BuiltinUnit[] = [
  { code: 'g/L', display: 'г/л', dimension: MASS_CONC, scale: 1, spellings: ['г/л', 'g/l'] },
  { code: 'g/dL', display: 'г/дл', dimension: MASS_CONC, scale: 1e1, spellings: ['г/дл', 'g/dl'] },
  {
    code: 'mg/dL',
    display: 'мг/дл',
    dimension: MASS_CONC,
    scale: 1e-2,
    spellings: ['мг/дл', 'mg/dl', 'мг%'],
  },
  { code: 'mg/L', display: 'мг/л', dimension: MASS_CONC, scale: 1e-3, spellings: ['мг/л', 'mg/l'] },
  {
    code: 'ug/mL',
    display: 'мкг/мл',
    dimension: MASS_CONC,
    scale: 1e-3,
    spellings: ['мкг/мл', 'µg/ml', 'ug/ml'],
  },
  {
    code: 'ug/dL',
    display: 'мкг/дл',
    dimension: MASS_CONC,
    scale: 1e-5,
    spellings: ['мкг/дл', 'µg/dl', 'ug/dl'],
  },
  { code: 'ug/L', display: 'мкг/л', dimension: MASS_CONC, scale: 1e-6, spellings: ['мкг/л', 'µg/l', 'ug/l'] },
  { code: 'ng/mL', display: 'нг/мл', dimension: MASS_CONC, scale: 1e-6, spellings: ['нг/мл', 'ng/ml'] },
  { code: 'ng/dL', display: 'нг/дл', dimension: MASS_CONC, scale: 1e-8, spellings: ['нг/дл', 'ng/dl'] },
  { code: 'ng/L', display: 'нг/л', dimension: MASS_CONC, scale: 1e-9, spellings: ['нг/л', 'ng/l'] },
  { code: 'pg/mL', display: 'пг/мл', dimension: MASS_CONC, scale: 1e-9, spellings: ['пг/мл', 'pg/ml'] },

  {
    code: 'mmol/L',
    display: 'ммоль/л',
    dimension: MOLAR_CONC,
    scale: 1e-3,
    spellings: ['ммоль/л', 'mmol/l'],
  },
  {
    code: 'umol/L',
    display: 'мкмоль/л',
    dimension: MOLAR_CONC,
    scale: 1e-6,
    spellings: ['мкмоль/л', 'µmol/l', 'umol/l'],
  },
  {
    code: 'nmol/L',
    display: 'нмоль/л',
    dimension: MOLAR_CONC,
    scale: 1e-9,
    spellings: ['нмоль/л', 'nmol/l'],
  },
  {
    code: 'pmol/L',
    display: 'пмоль/л',
    dimension: MOLAR_CONC,
    scale: 1e-12,
    spellings: ['пмоль/л', 'pmol/l'],
  },

  {
    code: '10*12/L',
    display: '×10¹²/л',
    dimension: COUNT_CONC,
    scale: 1e12,
    spellings: ['10*12/л', '10*12/l', 'млн/мкл', 'млн/мм3'],
  },
  {
    code: '10*9/L',
    display: '×10⁹/л',
    dimension: COUNT_CONC,
    scale: 1e9,
    spellings: ['10*9/л', '10*9/l', 'тыс/мкл', 'тыс/мм3', '10*3/мкл', '10*3/µl'],
  },
  { code: '10*6/L', display: '×10⁶/л', dimension: COUNT_CONC, scale: 1e6, spellings: ['10*6/л', '10*6/l'] },
  {
    code: '/uL',
    display: 'в мкл',
    dimension: COUNT_CONC,
    scale: 1e6,
    spellings: ['/мкл', 'в мкл', 'кл/мкл', '/µl'],
  },

  { code: 'U/L', display: 'Ед/л', dimension: ACTIVITY_CONC, scale: 1, spellings: ['ед/л', 'u/l'] },
  { code: 'IU/L', display: 'МЕ/л', dimension: ACTIVITY_CONC, scale: 1, spellings: ['ме/л', 'iu/l'] },
  { code: 'mU/L', display: 'мЕд/л', dimension: ACTIVITY_CONC, scale: 1e-3, spellings: ['мед/л', 'mu/l'] },
  { code: 'mIU/L', display: 'мМЕ/л', dimension: ACTIVITY_CONC, scale: 1e-3, spellings: ['мме/л', 'miu/l'] },
  { code: 'mIU/mL', display: 'мМЕ/мл', dimension: ACTIVITY_CONC, scale: 1, spellings: ['мме/мл', 'miu/ml'] },
  {
    code: 'uIU/mL',
    display: 'мкМЕ/мл',
    dimension: ACTIVITY_CONC,
    scale: 1e-3,
    spellings: ['мкме/мл', 'µiu/ml', 'uiu/ml', 'мкед/мл'],
  },
  { code: 'IU/mL', display: 'МЕ/мл', dimension: ACTIVITY_CONC, scale: 1e3, spellings: ['ме/мл', 'iu/ml'] },
  { code: 'U/mL', display: 'Ед/мл', dimension: ACTIVITY_CONC, scale: 1e3, spellings: ['ед/мл', 'u/ml'] },

  { code: '%', display: '%', dimension: FRACTION, scale: 1e-2, spellings: ['%'] },

  { code: 'fL', display: 'фл', dimension: 'cell_volume', scale: 1, spellings: ['фл', 'fl', 'мкм3'] },
  {
    code: 'pg',
    display: 'пг',
    dimension: 'cell_mass',
    scale: 1,
    spellings: ['пг', 'pg', 'пг/кл', 'пг/клетку'],
  },
  {
    code: 'mm/h',
    display: 'мм/ч',
    dimension: 'sedimentation_rate',
    scale: 1,
    spellings: ['мм/ч', 'мм/час', 'mm/h'],
  },
  { code: 's', display: 'с', dimension: 'time', scale: 1, spellings: ['с', 'сек', 's', 'sec'] },
  { code: 'min', display: 'мин', dimension: 'time', scale: 60, spellings: ['мин', 'min'] },
  { code: 'cm', display: 'см', dimension: 'length', scale: 1, spellings: ['см', 'cm'] },
  { code: 'g/mL', display: 'г/мл', dimension: 'density', scale: 1, spellings: ['г/мл', 'g/ml'] },
  {
    code: 'ug/g',
    display: 'мкг/г',
    dimension: 'mass_ratio',
    scale: 1e-6,
    spellings: ['мкг/г', 'µg/g', 'ug/g', 'мг/кг'],
  },
  { code: 'mg/g', display: 'мг/г', dimension: 'mass_ratio', scale: 1e-3, spellings: ['мг/г', 'mg/g'] },
  {
    code: 'mg/mmol',
    display: 'мг/ммоль',
    dimension: 'mass_per_amount',
    scale: 1,
    spellings: ['мг/ммоль', 'mg/mmol'],
  },
  {
    code: 'mmol/mol',
    display: 'ммоль/моль',
    dimension: 'molar_ratio',
    scale: 1e-3,
    spellings: ['ммоль/моль', 'mmol/mol'],
  },
  { code: 'g/d', display: 'г/сут', dimension: 'mass_rate', scale: 1, spellings: ['г/сут', 'g/day', 'g/24h'] },
  {
    code: 'mg/d',
    display: 'мг/сут',
    dimension: 'mass_rate',
    scale: 1e-3,
    spellings: ['мг/сут', 'mg/day', 'mg/24h'],
  },
  {
    code: 'ug/d',
    display: 'мкг/сут',
    dimension: 'mass_rate',
    scale: 1e-6,
    spellings: ['мкг/сут', 'µg/day', 'ug/day'],
  },
  {
    code: 'mmol/d',
    display: 'ммоль/сут',
    dimension: 'amount_rate',
    scale: 1e-3,
    spellings: ['ммоль/сут', 'mmol/day'],
  },
  {
    code: 'mOsm/kg',
    display: 'мОсм/кг',
    dimension: 'osmolality',
    scale: 1,
    spellings: ['мосм/кг', 'mosm/kg'],
  },
  {
    code: 'mL/min/1.73m2',
    display: 'мл/мин/1,73 м²',
    dimension: 'filtration_rate',
    scale: 1,
    spellings: ['мл/мин/1,73 кв м', 'мл/мин/1,73м2', 'мл/мин/1.73м2', 'мл/мин/1,73 м²', 'ml/min/1.73m2'],
  },
  {
    code: 'ug FEU/mL',
    display: 'мкг FEU/мл',
    dimension: 'feu_mass_conc',
    scale: 1,
    spellings: ['мкг feu/мл', 'µg feu/ml', 'ug feu/ml', 'мг feu/л'],
  },
  {
    code: 'ng FEU/mL',
    display: 'нг FEU/мл',
    dimension: 'feu_mass_conc',
    scale: 1e-3,
    spellings: ['нг feu/мл', 'ng feu/ml'],
  },
  { code: 'KP', display: 'КП', dimension: 'positivity_index', scale: 1, spellings: ['кп'] },
  { code: 'index', display: 'индекс', dimension: 'index', scale: 1, spellings: ['индекс', 'index'] },
  {
    code: 'BAU/mL',
    display: 'BAU/мл',
    dimension: 'binding_antibody_units',
    scale: 1,
    spellings: ['bau/мл', 'bau/ml'],
  },
  { code: 'OU/mL', display: 'ОЕд/мл', dimension: 'optical_units', scale: 1, spellings: ['оед/мл'] },
  { code: 'mln', display: 'млн', dimension: 'count_millions', scale: 1, spellings: ['млн'] },
]

/** Prefix of the code and dimension given to a spelling nobody has mapped yet. */
export const UNKNOWN_UNIT_PREFIX = '?:'

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

/**
 * The key a spelling is matched by: lowercase, ё → е, no spaces, one power-of-ten style
 * (`×10⁹/л`, `x10^9/л`, `*10^9/л`, `10*9/л` all become `10*9/л`), micro written as `µ`.
 */
export function normalizeUnitSpelling(spelling: string): string {
  return foldCase(spelling)
    .replaceAll('μ', 'µ')
    .replace(/\s+/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => `*${[...digits].map((d) => SUPERSCRIPTS[d]).join('')}`)
    .replace(/^[x×х*]10/, '10')
    .replaceAll('^', '*')
    .replace(/\*+/g, '*')
}

export interface UnitInfo {
  id: number
  code: string
  dimension: string
  scale: number
}

/** How one analyte converts between its units. */
export interface ConversionContext {
  canonical: UnitInfo | null
  /** g/mol; bridges molar and mass concentrations. */
  molarMass: number | null
  /** unit id → factor to the canonical unit, for pairs the dimensions cannot relate. */
  factors: ReadonlyMap<number, number>
}

function direct(value: number, from: UnitInfo, to: UnitInfo, molarMass: number | null): number | null {
  if (from.id === to.id) return value
  if (from.dimension === to.dimension) return (value * from.scale) / to.scale
  if (molarMass !== null && molarMass > 0) {
    if (from.dimension === MOLAR_CONC && to.dimension === MASS_CONC) {
      return (value * from.scale * molarMass) / to.scale
    }
    if (from.dimension === MASS_CONC && to.dimension === MOLAR_CONC) {
      return (value * from.scale) / molarMass / to.scale
    }
  }
  return null
}

/** `value` in `from` expressed in `to`, or null when nothing relates the two units. */
export function convert(value: number, from: UnitInfo, to: UnitInfo, ctx: ConversionContext): number | null {
  const straight = direct(value, from, to, ctx.molarMass)
  if (straight !== null) return straight
  const canonical = ctx.canonical
  if (!canonical) return null
  const fromFactor = ctx.factors.get(from.id)
  const inCanonical =
    fromFactor !== undefined ? value * fromFactor : direct(value, from, canonical, ctx.molarMass)
  if (inCanonical === null) return null
  const toFactor = ctx.factors.get(to.id)
  if (toFactor !== undefined) return inCanonical / toFactor
  return direct(inCanonical, canonical, to, ctx.molarMass)
}

export interface UnitRowLike extends UnitInfo {
  display: string
}

/**
 * Finds the unit a printed spelling means: the person's own mappings first, then the built-in
 * dictionary. Returns null for a spelling nobody has mapped.
 */
export function createUnitResolver(
  units: readonly UnitRowLike[],
  customSpellings: ReadonlyMap<string, number>,
): (spelling: string) => UnitRowLike | null {
  const byId = new Map(units.map((u) => [u.id, u]))
  const byCode = new Map(units.map((u) => [u.code, u]))
  const builtin = new Map<string, UnitRowLike>()
  for (const def of BUILTIN_UNITS) {
    const row = byCode.get(def.code)
    if (!row) continue
    for (const spelling of [def.code, def.display, ...def.spellings]) {
      builtin.set(normalizeUnitSpelling(spelling), row)
    }
  }
  return (spelling) => {
    const key = normalizeUnitSpelling(spelling)
    const custom = customSpellings.get(key)
    if (custom !== undefined) return byId.get(custom) ?? null
    return builtin.get(key) ?? byCode.get(`${UNKNOWN_UNIT_PREFIX}${key}`) ?? null
  }
}
