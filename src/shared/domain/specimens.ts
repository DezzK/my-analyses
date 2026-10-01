import type { Specimen } from './enums'
import { foldCase } from './text'

/**
 * The specimen a lab's test name states outright ("Глюкоза в моче", "Кальпротектин в кале"), or
 * the name of an analysis does ("Общий анализ мочи", "Копрограмма", "Спермограмма"). Anything less
 * explicit stays unknown: guessing "blood" would merge urine and blood analytes.
 */
const NAMED_SPECIMENS: readonly { pattern: RegExp; specimen: Specimen }[] = [
  { pattern: /(^|[^\p{L}])(моч[аиеуы]|в моче|мочи)([^\p{L}]|$)/u, specimen: 'urine' },
  { pattern: /(^|[^\p{L}])(кал[аеу]?|в кале|фекал\p{L}*|копрограмм\p{L}*)([^\p{L}]|$)/u, specimen: 'stool' },
  { pattern: /(^|[^\p{L}])(слюн[аеыу]|в слюне)([^\p{L}]|$)/u, specimen: 'saliva' },
  { pattern: /(^|[^\p{L}])(плазм[аеыу])([^\p{L}]|$)/u, specimen: 'plasma' },
  { pattern: /(^|[^\p{L}])(сыворотк[аеиу])([^\p{L}]|$)/u, specimen: 'serum' },
  {
    pattern: /(^|[^\p{L}])(спермограмм\p{L}*|эякулят\p{L}*|мазо?к\p{L}*|соскоб\p{L}*|отделяем\p{L}*|волос\p{L}*)([^\p{L}]|$)/u,
    specimen: 'other',
  },
]

export function inferSpecimen(testName: string): Specimen | null {
  const name = foldCase(testName)
  return NAMED_SPECIMENS.find((s) => s.pattern.test(name))?.specimen ?? null
}

/**
 * The specimen a lab names for a sample or a group of tests: «Моча», «Кровь (сыворотка)», «Кал».
 * Unlike a test's name, a material that says blood means it.
 */
export function specimenOfMaterial(material: string): Specimen | null {
  return inferSpecimen(material) ?? (/(^|[^\p{L}])кров\p{L}*/u.test(foldCase(material)) ? 'blood' : null)
}

/** Serum and plasma are blood: analytes of one kind of specimen can be one analyte. */
const SPECIMEN_KINDS: Readonly<Record<Specimen, Specimen>> = {
  blood: 'blood',
  serum: 'blood',
  plasma: 'blood',
  urine: 'urine',
  stool: 'stool',
  saliva: 'saliva',
  other: 'other',
}

export function specimenKind(specimen: Specimen): Specimen {
  return SPECIMEN_KINDS[specimen]
}
