import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/format'

interface ExpandableDescriptionProps {
  text: string
  /** Collapsed height in px. Expanded height is measured from the content. */
  previewHeight?: number
  className?: string
  textClassName?: string
}

/**
 * Shared expand/collapse block for artist bios, playlist descriptions and
 * album notes. Uses the measured content height (like the artist page) instead
 * of a fixed line clamp, so the transition is smooth at any width.
 */
export function ExpandableDescription({
  text,
  previewHeight = 75,
  className,
  textClassName,
}: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false)
  const [height, setHeight] = useState(0)
  const [expandedMaxHeight, setExpandedMaxHeight] = useState(520)
  const textRef = useRef<HTMLParagraphElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateMaxHeight = () => {
      setExpandedMaxHeight(
        Math.min(520, Math.max(260, window.innerHeight * 0.6)),
      )
    }
    updateMaxHeight()
    window.addEventListener('resize', updateMaxHeight)
    return () => window.removeEventListener('resize', updateMaxHeight)
  }, [])

  useEffect(() => {
    setExpanded(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [text])

  useEffect(() => {
    if (!expanded && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [expanded])

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => setHeight(element.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const canExpand = height > previewHeight
  const needsExpandedScroll =
    expanded && canExpand && height > expandedMaxHeight
  const visibleHeight = !height
    ? undefined
    : canExpand && !expanded
      ? previewHeight
      : Math.min(height, expandedMaxHeight)

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        className={cn(
          // Do not animate `height` here. Each frame forces the browser to
          // relayout and re-rasterise every text line, which made glyph edges
          // shimmer during expand/collapse. The state change now happens in a
          // single layout pass; only the chevron animates.
          expanded
            ? 'overflow-y-auto overscroll-contain'
            : 'overflow-hidden',
        )}
        style={{ height: visibleHeight }}
      >
        {needsExpandedScroll ? (
          <div className="sticky top-0 z-10 flex justify-end pb-1">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1 rounded-full border border-black/8 bg-white/90 px-2.5 py-1 text-[10.5px] text-accent shadow-sm backdrop-blur-md transition-colors hover:bg-white dark:border-white/10 dark:bg-black/55 dark:hover:bg-black/70"
            >
              <Trans>收起</Trans>
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>
        ) : null}
        <p
          ref={textRef}
          className={cn(
            'whitespace-pre-wrap text-left text-[11.5px] leading-relaxed text-black/40',
            textClassName,
          )}
        >
          {text}
        </p>
      </div>
      {canExpand ? (
        <div className="mt-1.5 flex justify-center">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-accent-hover"
          >
            {expanded ? <Trans>收起</Trans> : <Trans>展开全部</Trans>}
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform duration-300 motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
          </button>
        </div>
      ) : null}
    </div>
  )
}
