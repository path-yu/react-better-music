import { useEffect } from 'react'

const APP_NAME = '声屿'

/** Keep the window/document title in sync with the current page. */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [title])
}
