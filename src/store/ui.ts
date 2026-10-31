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
  sidebarOpen: boolean
  /** Desktop-only icon-free collapse; the mobile drawer uses sidebarOpen. */
  sidebarCollapsed: boolean
  theme: Theme
  /** Accent + surface palette; works in both light and dark themes. */
  palette: Palette
  openLogin: () => void
  closeLogin: () => void
  toggleSidebar: () => void
  closeSidebar: () => void
  toggleSidebarCollapsed: () => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setPalette: (palette: Palette) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      loginOpen: false,
      sidebarOpen: false,
      sidebarCollapsed: false,
      theme: 'light',
      palette: 'ocean',
      openLogin: () => set({ loginOpen: true }),
      closeLogin: () => set({ loginOpen: false }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebarCollapsed: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
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
      }),
    },
  ),
)
