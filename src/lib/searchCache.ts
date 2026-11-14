import type { SearchResult } from '../types'

/**
 * In-memory result cache for the search page. Re-entering /search (or coming
 * back to a tab/page) should not fire the same request again and flash its
 * skeleton; persisted keyword/tab state lives in the search store.
 */
const results = new Map<string, SearchResult>()
const MAX_ENTRIES = 30

export function getCachedSearchResult(key: string) {
  return results.get(key)
}

export function cacheSearchResult(key: string, result: SearchResult) {
  if (results.has(key)) results.delete(key)
  results.set(key, result)
  while (results.size > MAX_ENTRIES) {
    const oldest = results.keys().next().value
    if (oldest === undefined) break
    results.delete(oldest)
  }
}
