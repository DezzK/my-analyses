/**
 * Next.js sites stream server-rendered data as "React Server Components" payloads: JSON objects
 * embedded in a line-oriented text format. This finds the JSON objects that carry a given key,
 * wherever the payload puts them, without depending on the format's framing.
 */

/** Index just past the object that opens at `start`, or -1 if it never closes. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i += 1
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** How many enclosing `{` to try before giving up on one occurrence of the key. */
const MAX_NESTING = 40

/** Every distinct JSON object in `text` that has `key` as one of its own properties. */
export function objectsWithKey(text: string, key: string): Record<string, unknown>[] {
  const needle = JSON.stringify(key)
  const found: Record<string, unknown>[] = []
  const seen = new Set<number>()
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    let start = text.lastIndexOf('{', at)
    for (let tries = 0; tries < MAX_NESTING && start >= 0; tries++) {
      const end = objectEnd(text, start)
      if (end > at && !seen.has(start)) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, end))
          if (parsed && typeof parsed === 'object' && key in parsed) {
            seen.add(start)
            found.push(parsed as Record<string, unknown>)
            break
          }
        } catch {
          // Not a complete JSON object at this brace; try the enclosing one.
        }
      }
      start = text.lastIndexOf('{', start - 1)
    }
  }
  return found
}
