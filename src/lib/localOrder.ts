/**
 * Manual list order for locally reorderable collections (library page).
 * Only ids are stored, so a renamed or re-covered item keeps its position and
 * nothing needs to touch the API.
 */
export function readLocalOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export function writeLocalOrder(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // A full quota must not break dragging.
  }
}

/**
 * Apply a saved id order to a fresh list. Items that are not in the saved
 * order (newly collected, for example) keep their original position at the end,
 * so the list never drops rows.
 */
export function applyLocalOrder<T>(
  items: T[],
  order: string[],
  getId: (item: T) => string,
): T[] {
  if (!order.length) return items
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const rankA = rank.get(getId(a))
    const rankB = rank.get(getId(b))
    if (rankA === undefined && rankB === undefined) return 0
    if (rankA === undefined) return 1
    if (rankB === undefined) return -1
    return rankA - rankB
  })
}
