import type { ChatItem } from './items.tsx'

// The chat refresh reuses the item objects that did not change, so the memoized
// rows keep their identity and only new or changed rows render again. Comparing
// with JSON.stringify on every refresh serializes every message twice, so this
// compares field by field and stops at the first difference. Anything it cannot
// compare by identity falls back to the exact JSON check for that value, so the
// result is the same as stringifying the whole item — just without paying for
// it on the common case, where nothing changed.

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sameItem(a: ChatItem, b: ChatItem): boolean {
  if (a === b) return true
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  const known = new Set(keysA)
  for (const key of keysB) if (!known.has(key)) return false
  for (const key of keysA) {
    const x = (a as unknown as Record<string, unknown>)[key]
    const y = (b as unknown as Record<string, unknown>)[key]
    if (x === y) continue
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false
      for (let i = 0; i < x.length; i += 1) if (!sameValue(x[i], y[i])) return false
      continue
    }
    if (!sameValue(x, y)) return false
  }
  return true
}
