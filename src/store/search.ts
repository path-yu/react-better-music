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

/**
 * How the words after the song title are read: an artist ("歌名 歌手") or an
 * album ("歌名 专辑"). The deep search walks a different index for each.
 */
export type SearchMode = 'artist' | 'album'

interface SearchState {
  /** Last submitted/typed query, used when re-entering /search. */
  keyword: string
  tab: SearchTab
  /**
   * Incremented when the user submits the same query again (Enter). Navigating
   * to an identical URL is a no-op in TanStack Router, so this token is what
   * actually triggers the refetch.
   */
  refreshToken: number
  /** Whether the fallback lookup (web + albums) runs for missing songs. */
  deepSearch: boolean
  searchMode: SearchMode
  setSearch: (keyword: string, tab?: string) => void
  refresh: () => void
  toggleDeepSearch: () => void
  toggleSearchMode: () => void
  setSearchMode: (mode: SearchMode) => void
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
      refreshToken: 0,
      deepSearch: true,
      searchMode: 'artist',
      setSearch: (keyword, tab) =>
        set((state) => ({
          keyword,
          tab: tab === undefined ? state.tab : normalizeTab(tab),
        })),
      refresh: () =>
        set((state) => ({ refreshToken: state.refreshToken + 1 })),
      toggleDeepSearch: () =>
        set((state) => ({ deepSearch: !state.deepSearch })),
      toggleSearchMode: () =>
        set((state) => ({
          searchMode: state.searchMode === 'artist' ? 'album' : 'artist',
        })),
      setSearchMode: (mode) => set({ searchMode: mode }),
    }),
    {
      name: 'react-music-search',
      // The token is per-session; persisting it would only make the first
      // effect of the next launch run twice.
      partialize: (state) => ({
        keyword: state.keyword,
        tab: state.tab,
        deepSearch: state.deepSearch,
        searchMode: state.searchMode,
      }),
    },
  ),
)
