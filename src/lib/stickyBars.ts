/**
 * Marks `.sticky-bar` toolbars as `is-stuck` while they are pinned to the top
 * of their scroll container with content scrolled underneath. The bar is
 * drawn in the page colour, so its hairline only appears once it actually
 * separates the toolbar from rows passing under it.
 *
 * One capture-phase scroll listener covers every page; no per-page wiring.
 */

let installed = false

function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

function update() {
  for (const bar of document.querySelectorAll<HTMLElement>('.sticky-bar')) {
    const scroller = scrollParent(bar)
    if (!scroller) {
      bar.classList.remove('is-stuck')
      continue
    }
    const offset = Number.parseFloat(getComputedStyle(bar).top) || 0
    const edge =
      scroller === document.scrollingElement
        ? 0
        : scroller.getBoundingClientRect().top + scroller.clientTop
    const stuck =
      scroller.scrollTop > 0 && bar.getBoundingClientRect().top <= edge + offset + 1
    bar.classList.toggle('is-stuck', stuck)
  }
}

export function installStickyBars() {
  if (installed || typeof window === 'undefined') return
  installed = true
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }
  document.addEventListener('scroll', schedule, { capture: true, passive: true })
  window.addEventListener('resize', schedule, { passive: true })
}
