/**
 * Lowercase with ё folded into е: Russian texts use the two letters interchangeably, so every
 * comparison of words (vocabularies, unit spellings, search) goes through this.
 */
export function foldCase(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е')
}
