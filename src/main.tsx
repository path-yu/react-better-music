import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { applyTheme } from './lib/theme'
import { isDesktopShell } from './lib/desktop'
import { useUiStore } from './store/ui'
import { rememberBridgeToken, requestJson } from './lib/desktopBridge'

applyTheme(useUiStore.getState().theme)

// Desktop builds append the local bridge token to the view URL. Capture it
// before the router rewrites the location, so download requests can use it.
const bridgeToken = new URLSearchParams(window.location.search).get('bridgeToken')
if (bridgeToken) {
  ;(window as typeof window & { __bridgeToken?: string }).__bridgeToken = bridgeToken
  rememberBridgeToken(bridgeToken)
  // Hash history appends `location.search` to the hash path, which would make
  // every route search param end with `?bridgeToken=...`. The token is already
  // cached above, so drop it from the address bar before the router boots.
  const { pathname, hash } = window.location
  try {
    window.history.replaceState(window.history.state, '', `${pathname}${hash}`)
  } catch {
    // A custom scheme may reject history updates; the bridge still works.
  }
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

if (desktop) {
  // Two frames: the first runs after commit, the second after the first paint.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void requestJson('/startup-report', {
        method: 'POST',
        body: JSON.stringify({
          paint: performance.now(),
          secure: window.isSecureContext,
          audioEncoder: typeof AudioEncoder,
        }),
      }).catch(() => undefined)
    })
  })
}
