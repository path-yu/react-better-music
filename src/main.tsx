import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { applyTheme } from './lib/theme'
import { isDesktopShell } from './lib/desktop'
import { useUiStore } from './store/ui'

applyTheme(useUiStore.getState().theme)

const desktop = isDesktopShell()
if (desktop) {
  document.documentElement.classList.add('desktop')
}

const router = createRouter({
  routeTree,
  // Bundled desktop views use a custom protocol, where path-based URLs would
  // 404 on reload; hash history keeps deep links working.
  history: desktop ? createHashHistory() : undefined,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')!

ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />)
