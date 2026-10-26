import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { applyTheme } from './lib/theme'
import { isDesktopShell } from './lib/desktop'
import { useUiStore } from './store/ui'

applyTheme(useUiStore.getState().theme)

// Desktop builds append the local bridge token to the view URL. Capture it
// before the router rewrites the location, so download requests can use it.
const bridgeToken = new URLSearchParams(window.location.search).get('bridgeToken')
if (bridgeToken) {
  ;(window as typeof window & { __bridgeToken?: string }).__bridgeToken = bridgeToken
}

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
