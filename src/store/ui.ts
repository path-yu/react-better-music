import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

interface UiState {
  loginOpen: boolean
  sidebarOpen: boolean
  theme: Theme
  openLogin: () => void
  closeLogin: () => void
  toggleSidebar: () => void
  closeSidebar: () => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      loginOpen: false,
      sidebarOpen: false,
      theme: 'light',
      openLogin: () => set({ loginOpen: true }),
      closeLogin: () => set({ loginOpen: false }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
    }),
    {
      name: 'react-music-ui',
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
)
