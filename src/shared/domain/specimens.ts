import type { Specimen } from './enums'
import { foldCase } from './text'

/**
 * The specimen a lab's test name states outright ("Глюкоза в моче", "Кальпротектин в кале").
 * Anything less explicit stays unknown: guessing "blood" would merge urine and blood analytes.
 */
const NAMED_SPECIMENS: readonly { pattern: RegExp; specimen: Specimen }[] = [
  { pattern: /(^|[^\p{L}])(моч[аиеуы]|в моче|мочи)([^\p{L}]|$)/u, specimen: 'urine' },
  { pattern: /(^|[^\p{L}])(кал[аеу]?|в кале|фекал\p{L}*)([^\p{L}]|$)/u, specimen: 'stool' },
  { pattern: /(^|[^\p{L}])(слюн[аеыу]|в слюне)([^\p{L}]|$)/u, specimen: 'saliva' },
  { pattern: /(^|[^\p{L}])(плазм[аеыу])([^\p{L}]|$)/u, specimen: 'plasma' },
  { pattern: /(^|[^\p{L}])(сыворотк[аеиу])([^\p{L}]|$)/u, specimen: 'serum' },
]

export function inferSpecimen(testName: string): Specimen | null {
  const name = foldCase(testName)
  return NAMED_SPECIMENS.find((s) => s.pattern.test(name))?.specimen ?? null
}
