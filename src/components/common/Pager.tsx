import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { cn } from '../../lib/format'

interface PagerProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
  className?: string
}

export function Pager({ page, pageCount, onChange, className }: PagerProps) {
  if (pageCount <= 1) return null

  const pages: number[] = []
  const start = Math.max(1, Math.min(page - 2, pageCount - 4))
  const end = Math.min(pageCount, start + 4)
  for (let index = start; index <= end; index += 1) pages.push(index)

  return (
    <div className={cn('flex items-center justify-center gap-1.5', className)}>
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
      {start > 1 ? <span className="text-[10px] text-black/25">…</span> : null}
      {pages.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            'h-7 min-w-7 rounded-full px-2 text-[11px] tabular-nums transition-colors',
            item === page
              ? 'bg-[#0066cc] font-medium text-white'
              : 'border border-black/8 bg-white text-black/50 hover:bg-black/4',
          )}
        >
          {item}
        </button>
      ))}
      {end < pageCount ? <span className="text-[10px] text-black/25">…</span> : null}
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
    </div>
  )
}
