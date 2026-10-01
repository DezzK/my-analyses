import type { Specimen, ValueKind } from '@shared/domain/enums'
import { inferSpecimen } from '@shared/domain/specimens'
import { foldCase } from '@shared/domain/text'
import { BUILTIN_UNITS } from '@shared/domain/units'
import { DICTIONARY, type DictionaryEntry } from './entries'

/** What the dictionary compares of an analyte. */
export interface AnalyteTraits {
  /** Its name and its synonyms. */
  names: readonly string[]
  specimen: Specimen | null
  valueKind: ValueKind
  /** Its canonical unit; null when its results come without one. */
  unit: { dimension: string; scale: number } | null
}

/** Latin letters drawn like Cyrillic ones: «CA 125» and «СА 125», «T4» and «Т4» are typed both ways. */
const LOOKALIKES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    a: 'а',
    b: 'в',
    c: 'с',
    e: 'е',
    h: 'н',
    k: 'к',
    m: 'м',
    o: 'о',
    p: 'р',
    t: 'т',
    x: 'х',
    y: 'у',
  }),
)
const GREEK: ReadonlyMap<string, string> = new Map(Object.entries({ α: 'альфа', β: 'бета', γ: 'гамма' }))

/** The words of a text, case, ё and look-alike letters folded, letters and digits apart. */
function words(text: string): string[] {
  const folded = [...foldCase(text)].map((ch) => {
    const greek = GREEK.get(ch)
    return greek === undefined ? (LOOKALIKES.get(ch) ?? ch) : ` ${greek} `
  })
  return folded
    .join('')
    .replace(/(\p{L})(?=\p{N})|(\p{N})(?=\p{L})/gu, '$1$2 ')
    .split(/[^\p{L}\p{N}+]+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
}

const wordSet = (texts: readonly string[]) => new Set(texts.flatMap(words))

/** How a cell type is counted, which its unit tells anyway: «Нейтрофилы, абс.», «NE%». */
const COUNTING = wordSet([
  'абс абсол абсолютное абсолютный абсолютная кол во количество число отн относительное относительный содержание',
])
/** Words saying blood that `inferSpecimen` leaves unread on purpose, since blood is the default. */
const BLOOD = wordSet(['кровь крови венозная венозной капиллярная капиллярной цельная цельной'])

/** Serum and plasma are blood to the dictionary. */
const SPECIMEN_KIND: Record<Specimen, Specimen> = {
  blood: 'blood',
  serum: 'blood',
  plasma: 'blood',
  urine: 'urine',
  stool: 'stool',
  saliva: 'saliva',
  other: 'other',
}

/** The specimen a word of a name says, as the import reads it from a whole name. */
function specimenOf(word: string): Specimen | null {
  return BLOOD.has(word) ? 'blood' : inferSpecimen(word)
}

/**
 * What a name says the analyte is, in a fixed order of words: «Холестерин-ЛПНП» and «ЛПНП
 * холестерин» agree, as do «Т4 св.» and «T4 СВ», «Глюкоза в плазме» and «Глюкоза» (blood is the
 * default), «Глюкоза в моче» and «Глюкоза (моча)». Unlike search (`normalizeSearchText`), which
 * finds what was typed anywhere in a name, this compares whole names, and so can fold more.
 */
export function nameKey(text: string): string {
  const all = words(text)
  const kept = all.flatMap((word, i) => {
    const next = all[i + 1]
    if (COUNTING.has(word) || (word === 'в' && next !== undefined && specimenOf(next) !== null)) return []
    const specimen = specimenOf(word)
    if (specimen === null) return [word]
    return SPECIMEN_KIND[specimen] === 'blood' ? [] : [specimen]
  })
  return [...new Set(kept)].sort().join(' ')
}

/** Words that make a part of a name another analyte: «Т4 (свободный)» is not «Т4». */
const QUALIFIERS = wordSet([
  'свободный свободная свободное свободного своб св общий общая общее общего общ прямой непрямой связанный',
  'ионизированный ионизир IgG IgM IgA IgE авидность индекс не высокочувствительный',
  'ультрачувствительный hs клиренс экскреция суточная суточной суточный соотношение отношение фракция изофермент',
])

const BRACKETED = /\(([^()]*)\)|\[([^[\]]*)\]/g

/**
 * The parts of a name: the name without what stands in brackets, what stands in each pair of
 * brackets, and what commas, semicolons or spaced dashes set apart in either.
 */
function parts(name: string): string[] {
  const inside = [...name.matchAll(BRACKETED)].map((match) => match[1] ?? match[2] ?? '')
  const outside = name.replace(BRACKETED, ' ')
  const pieces = [outside, ...inside].flatMap((text) => [text, ...text.split(/[,;]|\s[-–—]\s/)])
  return [...new Set(pieces)].filter((part) => nameKey(part) !== '')
}

const BY_NAME: ReadonlyMap<string, readonly DictionaryEntry[]> = (() => {
  const index = new Map<string, DictionaryEntry[]>()
  for (const entry of DICTIONARY) {
    for (const key of new Set(entry.names.map(nameKey))) index.set(key, [...(index.get(key) ?? []), entry])
  }
  return index
})()

const UNIT_BY_CODE = new Map(BUILTIN_UNITS.map((unit) => [unit.code, unit]))

/**
 * Whether the analyte can be the entry: its specimen, if known, is the entry's; its results are
 * numbers unless the entry is answered in words, which come without a unit; and its unit is one of
 * the entry's, value for value (мкМЕ/мл and мМЕ/л alike) — a unit of the same kind on another
 * scale is a different analyte as often as not (leukocytes per microliter are urine's, per liter
 * blood's).
 */
export function fits(entry: DictionaryEntry, analyte: AnalyteTraits): boolean {
  if (analyte.specimen !== null && SPECIMEN_KIND[analyte.specimen] !== SPECIMEN_KIND[entry.specimen])
    return false
  const inWords = analyte.valueKind !== 'numeric'
  if (inWords && !entry.words) return false
  const unit = analyte.unit
  if (unit === null) return inWords || entry.units.includes(null)
  return entry.units.some((code) => {
    const own = code === null ? undefined : UNIT_BY_CODE.get(code)
    return own !== undefined && own.dimension === unit.dimension && own.scale === unit.scale
  })
}

const single = <T>(items: readonly T[]): T | null => (items.length === 1 ? (items[0] ?? null) : null)

/** The entries a name, or a part of one, names and the analyte fits. */
function fitting(text: string, analyte: AnalyteTraits): readonly DictionaryEntry[] {
  return (BY_NAME.get(nameKey(text)) ?? []).filter((entry) => fits(entry, analyte))
}

/**
 * The entry a name names: the whole of it, or else its parts — «Тиреотропный гормон (ТТГ), 3-е
 * поколение» is TSH by its first two — when they agree. A word that changes what a name means
 * («свободный», «IgG») must belong to a part that names the entry: «Т4 (свободный)» is not the
 * entry of «Т4», «Билирубин общий (TBIL)» is that of «Билирубин общий».
 */
function entryOf(name: string, analyte: AnalyteTraits): DictionaryEntry | null {
  const whole = fitting(name, analyte)
  if (whole.length > 0) return single(whole)
  const pieces = parts(name).map((part) => ({ entries: fitting(part, analyte), words: new Set(words(part)) }))
  const qualifiers = words(name).filter((word) => QUALIFIERS.has(word))
  const named = [...new Set(pieces.flatMap((piece) => piece.entries))].filter((entry) =>
    qualifiers.every((word) =>
      pieces.some((piece) => piece.entries.includes(entry) && piece.words.has(word)),
    ),
  )
  return single(named)
}

/** The one entry of the dictionary the analyte is, by its names, specimen, results and unit. */
export function findEntry(analyte: AnalyteTraits): DictionaryEntry | null {
  const found = new Set(analyte.names.flatMap((name) => entryOf(name, analyte) ?? []))
  return single([...found])
}
