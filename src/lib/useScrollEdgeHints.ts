import { useEffect } from 'react'

/**
 * Marks a horizontal scroller with `data-fade-start` / `data-fade-end` while
 * there is more content off that edge, so CSS can fade the edge and hint that
 * the row scrolls. Writes attributes directly: no re-render per scroll frame.
 */
export function useScrollEdgeHints(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return
    const update = () => {
      const max = element.scrollWidth - element.clientWidth
      element.toggleAttribute('data-fade-start', max > 1 && element.scrollLeft > 1)
      element.toggleAttribute('data-fade-end', max > 1 && element.scrollLeft < max - 1)
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    // Labels change width (comment count arrives later, language switch).
    const mutations = new MutationObserver(update)
    mutations.observe(element, { subtree: true, childList: true, characterData: true })
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
      mutations.disconnect()
      element.removeAttribute('data-fade-start')
      element.removeAttribute('data-fade-end')
    }
  }, [element])
}
