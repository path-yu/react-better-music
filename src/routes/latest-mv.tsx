import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Film } from 'lucide-react'
import { Skeleton } from '@pikoloo/darwin-ui'
import { MvCard } from '../components/cards/MvCard'
import { EmptyState } from '../components/common/EmptyState'
import { Pager } from '../components/common/Pager'
import { fetchMvList } from '../api'
import { cn } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { Mv } from '../types'

export const Route = createFileRoute('/latest-mv')({
  component: LatestMvPage,
})

const AREAS = ['全部', '内地', '港台', '欧美', '日本', '韩国']
const TYPES = ['全部', '官方版', '现场版', '原生', '网易出品']
const ORDERS = ['最热', '最新', '上升最快']
const PAGE_SIZE = 24

function LatestMvPage() {
  useDocumentTitle('最新 MV')
  const [area, setArea] = useState('全部')
  const [type, setType] = useState('全部')
  const [order, setOrder] = useState('最热')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [list, setList] = useState<Mv[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    fetchMvList(
      { area, type, order, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
      controller.signal,
    )
      .then((result) => {
        if (cancelled) return
        // Without a total count the next page is speculative; if it turns out
        // to be empty, step back instead of leaving the user on a blank page.
        if (!result.list.length && page > 1) {
          setPage(page - 1)
          return
        }
        setList(result.list)
        setPageCount(
          result.count
            ? Math.max(1, Math.ceil(result.count / PAGE_SIZE))
            : result.list.length === PAGE_SIZE
              ? page + 1
              : page,
        )
      })
      .catch(() => {
        if (!cancelled) toast.error('MV 加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [area, type, order, page])

  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
    document.querySelector('.apple-content')?.scrollTo({ top: 0 })
  }

  return (
    <div className="px-8 pb-14 pt-6">
      <div>
        <h1 className="headline-lg flex items-center gap-2">
          <Film className="h-5 w-5 text-accent" />
          最新 MV
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">按地区、类型与热度浏览音乐视频</p>
      </div>

      <div className="mt-5 space-y-2.5 rounded-[18px] border border-black/8 bg-[#fafafc] px-4 py-3.5">
        <FilterRow label="地区" options={AREAS} value={area} onChange={(value) => changeFilter(setArea, value)} />
        <FilterRow label="类型" options={TYPES} value={type} onChange={(value) => changeFilter(setType, value)} />
        <FilterRow label="排序" options={ORDERS} value={order} onChange={(value) => changeFilter(setOrder, value)} />
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="aspect-video w-full rounded-[14px]" />
                <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                <Skeleton className="mt-1.5 h-2.5 w-2/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : list.length ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {list.map((mv, index) => (
              <MvCard key={mv.id} mv={mv} priority={index < 4} />
            ))}
          </div>
        ) : (
          <EmptyState title="暂无 MV" />
        )}
      </div>

      <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-7" />
    </div>
  )
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-[11px] font-medium text-black/30">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] transition-colors',
              value === option
                ? 'bg-accent text-white'
                : 'text-black/45 hover:bg-black/5 hover:text-black/70',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
