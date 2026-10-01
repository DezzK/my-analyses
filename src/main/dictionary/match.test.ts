import { describe, expect, it } from 'vitest'
import { SPECIMENS, VALUE_KINDS } from '@shared/domain/enums'
import { BUILTIN_UNITS, type UnitCode } from '@shared/domain/units'
import { DICTIONARY } from './entries'
import { findEntry, fits, nameKey, type AnalyteTraits } from './match'

function unit(code: UnitCode) {
  const found = BUILTIN_UNITS.find((u) => u.code === code)
  if (!found) throw new Error(code)
  return { dimension: found.dimension, scale: found.scale }
}

/** The key of the entry a lab's analyte would be linked to, or null. */
function entryOf(name: string, code: UnitCode | null, more: Partial<AnalyteTraits> = {}): string | null {
  const traits = {
    names: [name],
    specimen: null,
    valueKind: 'numeric' as const,
    unit: code && unit(code),
    ...more,
  }
  return findEntry(traits)?.key ?? null
}

describe('nameKey', () => {
  it('reads a name the same whatever the order of its words, the script of its letters or its punctuation', () => {
    expect(nameKey('Холестерин-ЛПНП')).toBe(nameKey('ЛПНП холестерин'))
    expect(nameKey('CA 125')).toBe(nameKey('СА-125'))
    expect(nameKey('СА125')).toBe(nameKey('CA 125'))
    expect(nameKey('Витамин B12')).toBe(nameKey('Витамин В12'))
    expect(nameKey('β-ХГЧ')).toBe(nameKey('Бета-ХГЧ'))
    expect(nameKey('Т4 св.')).toBe(nameKey('T4 СВ'))
  })

  it('leaves out blood, which is the default, and how a cell type is counted, which the unit tells', () => {
    expect(nameKey('Глюкоза в плазме')).toBe(nameKey('Глюкоза'))
    expect(nameKey('Железо сыворотки')).toBe(nameKey('Железо'))
    expect(nameKey('Нейтрофилы, абс.')).toBe(nameKey('Нейтрофилы, %'))
    expect(nameKey('NE%')).toBe(nameKey('NE#'))
  })

  it('spells other specimens one way', () => {
    expect(nameKey('Глюкоза в моче')).toBe(nameKey('Глюкоза (моча)'))
    expect(nameKey('глюкоза мочи')).toBe(nameKey('Глюкоза в моче'))
    expect(nameKey('Глюкоза в моче')).not.toBe(nameKey('Глюкоза'))
  })
})

describe('findEntry', () => {
  it('knows an analyte by its whole name, its parts or its abbreviation', () => {
    for (const name of [
      'Тиреотропный гормон (ТТГ)',
      'ТТГ (тиреотропный гормон)',
      'Тиреотропный гормон (ТТГ), 3-е поколение',
      'TSH',
    ]) {
      expect(entryOf(name, 'uIU/mL')).toBe('tsh')
    }
    expect(entryOf('MCV (ср. объем эритр.)', 'fL')).toBe('mcv')
    expect(entryOf('Средний объем эритроцита - MCV', 'fL')).toBe('mcv')
  })

  it('takes units that are the same value for value, and no others', () => {
    expect(entryOf('ТТГ', 'mIU/L')).toBe('tsh')
    expect(entryOf('ТТГ', 'mIU/mL')).toBeNull()
    expect(entryOf('Ферритин', 'ug/L')).toBe('ferritin')
  })

  it('tells a share from a count, and blood cells from those of urine, by the unit', () => {
    expect(entryOf('Нейтрофилы, %', '%')).toBe('neutrophils_share')
    expect(entryOf('Нейтрофилы, абс.', '10*9/L')).toBe('neutrophils_count')
    expect(entryOf('Нейтрофилы', null)).toBeNull()
    expect(entryOf('Лейкоциты', '10*9/L')).toBe('leukocytes')
    expect(entryOf('Лейкоциты', '/uL', { specimen: 'urine' })).toBe('urine_leukocytes')
  })

  it('keeps to the specimen the analyte is of', () => {
    expect(entryOf('Глюкоза', 'mmol/L', { specimen: 'serum' })).toBe('glucose')
    expect(entryOf('Глюкоза', 'mmol/L')).toBe('glucose')
    expect(entryOf('Глюкоза', 'mmol/L', { specimen: 'urine' })).toBe('urine_glucose')
    expect(entryOf('Глюкоза в моче', 'mmol/L', { specimen: 'urine' })).toBe('urine_glucose')
  })

  it('knows a finding named alike in every specimen only within an analysis of its specimen', () => {
    const inWords = { valueKind: 'text' } as const
    expect(entryOf('Слизь', null, { ...inWords, specimen: 'urine' })).toBe('urine_mucus')
    expect(entryOf('Слизь', null, { ...inWords, specimen: 'stool' })).toBe('stool_mucus')
    expect(entryOf('Слизь', null, inWords)).toBeNull()
    expect(entryOf('Лейкоциты', '/uL')).toBeNull()
    // A count per milliliter, without a unit, is not a sediment's.
    expect(entryOf('Лейкоциты', null, { specimen: 'urine' })).toBeNull()
  })

  it('takes results in words, which come without a unit, only for analytes labs answer in words', () => {
    expect(entryOf('Глюкоза', null, { valueKind: 'qualitative' })).toBeNull()
    expect(entryOf('HBsAg', null, { valueKind: 'qualitative' })).toBe('hbsag')
    expect(entryOf('Кетоновые тела', null, { valueKind: 'qualitative' })).toBe('urine_ketones')
    expect(entryOf('Кетоновые тела', null)).toBeNull()
  })

  it('reads a name without what stands in brackets, and lists in brackets item by item', () => {
    expect(entryOf('Простат-специфический антиген (ПСА) общий', 'ng/mL')).toBe('psa_total')
    expect(entryOf('Глобулин, связывающий половые гормоны (SHBG, ГСПГ)', 'nmol/L')).toBe('shbg')
  })

  it('knows antibodies named in Russian with the Latin name in brackets, or in Latin alone', () => {
    expect(entryOf('Антитела к микоплазме (Mycoplasma pneumoniae), IgA', 'KP')).toBe(
      'mycoplasma_pneumoniae_iga',
    )
    expect(entryOf('Chlamydia pneumoniae, IgM', null, { valueKind: 'qualitative' })).toBe(
      'chlamydophila_pneumoniae_igm',
    )
  })

  it('does not let one part of a name stand for it when another part changes what it is', () => {
    expect(entryOf('Холестерин (метод CHOD-PAP)', 'mmol/L')).toBe('cholesterol')
    expect(entryOf('Холестерин (свободный)', 'mmol/L')).toBeNull()
    expect(entryOf('Т4 (свободный)', 'pmol/L')).toBe('free_t4')
    expect(entryOf('Кальций (ионизированный)', 'mmol/L')).toBe('ionized_calcium')
  })

  it('finds nothing when names point at different entries', () => {
    expect(entryOf('ЛПВП (ЛПНП)', 'mmol/L')).toBeNull()
    expect(
      findEntry({
        names: ['Глюкоза', 'Мочевина'],
        specimen: null,
        valueKind: 'numeric',
        unit: unit('mmol/L'),
      }),
    ).toBeNull()
    expect(
      findEntry({ names: ['Код 17', 'Мочевина'], specimen: null, valueKind: 'numeric', unit: unit('mmol/L') })
        ?.key,
    ).toBe('urea')
  })
})

describe('the dictionary', () => {
  it('gives every entry its own key and every name words to match', () => {
    const keys = DICTIONARY.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of DICTIONARY) {
      for (const name of entry.names) expect(nameKey(name), `${entry.key}: ${name}`).not.toBe('')
    }
  })

  it('never lets one analyte fit two entries of one name', () => {
    const units = [null, ...BUILTIN_UNITS.map((u) => ({ dimension: u.dimension, scale: u.scale }))]
    const byName = Map.groupBy(
      DICTIONARY.flatMap((entry) => [...new Set(entry.names.map(nameKey))].map((key) => ({ key, entry }))),
      (named) => named.key,
    )
    for (const [name, named] of byName) {
      // A name of one entry cannot fit two.
      if (named.length < 2) continue
      for (const specimen of [null, ...SPECIMENS]) {
        for (const valueKind of VALUE_KINDS) {
          for (const u of units) {
            const fitting = named
              .filter(({ entry }) => fits(entry, { names: [], specimen, valueKind, unit: u }))
              .map(({ entry }) => entry.key)
            expect(fitting.length, `«${name}» fits ${fitting.join(', ')}`).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})
