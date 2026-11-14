import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SearchTab =
  | 'songs'
  | 'playlists'
  | 'albums'
  | 'artists'
  | 'users'
  | 'mvs'
  | 'videos'

const SEARCH_TABS: readonly SearchTab[] = [
  'songs',
  'playlists',
  'albums',
  'artists',
  'users',
  'mvs',
  'videos',
]

function normalizeTab(value: unknown): SearchTab {
  return SEARCH_TABS.includes(value as SearchTab)
    ? (value as SearchTab)
    : 'songs'
}

interface SearchState {
  /** Last submitted/typed query, used when re-entering /search. */
  keyword: string
  tab: SearchTab
  setSearch: (keyword: string, tab?: string) => void
}

/**
 * Keep the search page alive across sidebar navigation. The route itself is
 * still the source of truth while visible; this store only remembers the last
 * query/tab so the Search menu can reopen the same result screen.
 */
export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      keyword: '',
      tab: 'songs',
      setSearch: (keyword, tab) =>
        set((state) => ({
          keyword,
          tab: tab === undefined ? state.tab : normalizeTab(tab),
        })),
    }),
    { name: 'react-music-search' },
  ),
)
