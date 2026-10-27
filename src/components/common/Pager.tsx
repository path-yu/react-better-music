import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { cn } from '../../lib/format'

interface PagerProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
  className?: string
}

export function Pager({ page, pageCount, onChange, className }: PagerProps) {
  const [draft, setDraft] = useState(String(page))

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(page))
      return
    }
    const next = Math.min(pageCount, Math.max(1, Math.round(parsed)))
    setDraft(String(next))
    if (next !== page) onChange(next)
  }

  if (pageCount <= 1) return null

  const pages: number[] = []
  const start = Math.max(1, Math.min(page - 2, pageCount - 4))
  const end = Math.min(pageCount, start + 4)
  for (let index = start; index <= end; index += 1) pages.push(index)

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-1.5', className)}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="第一页"
        className="h-7 rounded-full px-1.5 text-[11px]"
        disabled={page <= 1}
        onClick={() => onChange(1)}
      >
        <ChevronsLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="上一页"
        className="h-7 rounded-full px-2 text-[11px]"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      {start > 1 ? <span className="text-[11px] text-black/25">…</span> : null}
      {pages.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            'h-7 min-w-7 rounded-full px-2 text-[11px] tabular-nums transition-colors',
            item === page
              ? 'bg-accent font-medium text-white'
              : 'border border-black/8 bg-white text-black/50 hover:bg-black/4',
          )}
        >
          {item}
        </button>
      ))}
      {end < pageCount ? <span className="text-[11px] text-black/25">…</span> : null}
      <Button
        variant="ghost"
        size="sm"
        aria-label="下一页"
        className="h-7 rounded-full px-2 text-[11px]"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="最后一页"
        className="h-7 rounded-full px-1.5 text-[11px]"
        disabled={page >= pageCount}
        onClick={() => onChange(pageCount)}
      >
        <ChevronsRight className="h-3.5 w-3.5" />
      </Button>

      <label className="ml-1 flex items-center gap-1 text-[11px] text-black/30">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          aria-label="跳转页码"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
          className="h-7 w-11 rounded-full border border-black/8 bg-white px-2 text-center text-[11px] tabular-nums text-black/60 outline-none transition-colors focus:border-accent/50"
        />
        <span className="tabular-nums">/ {pageCount}</span>
      </label>
    </div>
  )
}
