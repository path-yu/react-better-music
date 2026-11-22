import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'
export type Palette =
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'sakura'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'amber'
  | 'graphite'
  | 'mocha'

interface UiState {
  loginOpen: boolean
  importPlaylistOpen: boolean
  sidebarOpen: boolean
  /**
   * The user's own collapse choice (desktop only; the mobile drawer uses
   * sidebarOpen). What is shown also depends on sidebarAutoCollapse: read it
   * through useSidebarCollapsed(), not directly.
   */
  sidebarCollapsed: boolean
  /** Collapse to the icon rail while the window is 768–1023px wide. */
  sidebarAutoCollapse: boolean
  theme: Theme
  /** Accent + surface palette; works in both light and dark themes. */
  palette: Palette
  openLogin: () => void
  closeLogin: () => void
  openImportPlaylist: () => void
  closeImportPlaylist: () => void
  toggleSidebar: () => void
  closeSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarAutoCollapse: (enabled: boolean) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setPalette: (palette: Palette) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      loginOpen: false,
      importPlaylistOpen: false,
      sidebarOpen: false,
      sidebarCollapsed: false,
      sidebarAutoCollapse: true,
      theme: 'light',
      palette: 'ocean',
      openLogin: () => set({ loginOpen: true }),
      closeLogin: () => set({ loginOpen: false }),
      openImportPlaylist: () => set({ importPlaylistOpen: true }),
      closeImportPlaylist: () => set({ importPlaylistOpen: false }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarAutoCollapse: (sidebarAutoCollapse) => set({ sidebarAutoCollapse }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setPalette: (palette) => set({ palette }),
    }),
    {
      name: 'react-music-ui',
      partialize: (state) => ({
        theme: state.theme,
        palette: state.palette,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarAutoCollapse: state.sidebarAutoCollapse,
      }),
    },
  ),
)
