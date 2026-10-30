import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ChartNoAxesColumnIncreasing, Play } from 'lucide-react'
import { Skeleton } from '@pikoloo/darwin-ui'
import { EmptyState } from '../components/common/EmptyState'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { fetchToplists } from '../api'
import { formatArtists, formatNumber } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { Toplist } from '../types'

export const Route = createFileRoute('/toplist')({
  component: ToplistPage,
})

function ToplistPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [lists, setLists] = useState<Toplist[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useDocumentTitle(i18n._(msg`排行榜`))

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    fetchToplists(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setLists(next)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFailed(true)
        toast.error(i18n._(msg`榜单加载失败`))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // The request is keyed by the retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const openChart = (list: Toplist) => {
    void navigate({
      to: '/songlists/$id',
      params: { id: String(list.id) },
    })
  }

  return (
    <div className="px-8 pb-16 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            <Trans>发现音乐</Trans>
          </p>
          <h1 className="headline-lg mt-1.5">
            <Trans>排行榜</Trans>
          </h1>
          <p className="mt-2 text-[12px] text-black/40">
            <Trans>云音乐官方榜单，实时更新</Trans>
          </p>
        </div>
        {!loading && !failed ? (
          <p className="shrink-0 text-[11px] text-black/30">
            <Trans>共 {lists.length} 张榜单</Trans>
          </p>
        ) : null}
      </div>

      {failed ? (
        <div className="mt-8">
          <EmptyState
            variant="error"
            title={i18n._(msg`榜单加载失败`)}
            description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </div>
      ) : loading ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[224px] w-full rounded-[16px]" />
          ))}
        </div>
      ) : lists.length ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {lists.map((list, index) => (
            <button
              key={list.id}
              type="button"
              onClick={() => openChart(list)}
              className="apple-card apple-card-hover group flex h-full gap-4 p-4 text-left transition-colors hover:bg-white/80"
            >
              <div className="relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_10px_30px_-20px_rgba(0,0,0,0.32)]">
                <ImageWithFallback
                  src={list.coverImgUrl}
                  alt={list.name}
                  rounded="rounded-[10px]"
                  resize="240y240"
                  priority={index < 4}
                  className="h-full w-full"
                  imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
                />
                <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
                  <Play className="h-2.5 w-2.5 fill-current" />
                  {formatNumber(list.playCount)}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-black/80 transition-colors group-hover:text-accent">
                    {list.name}
                  </h2>
                  <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] text-black/35">
                    TOP {list.trackCount ?? 100}
                  </span>
                </div>
                {list.description ? (
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-black/40">
                    {list.description}
                  </p>
                ) : null}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-black/30">
                  {list.updateFrequency ? <span>{list.updateFrequency}</span> : null}
                  <span>·</span>
                  <span>
                    <Trans>{list.trackCount ?? 0} 首</Trans>
                  </span>
                </p>

                {list.tracks?.length ? (
                  <div className="mt-auto space-y-1 border-t border-black/[0.055] pt-2">
                    {list.tracks.slice(0, 3).map((track, trackIndex) => (
                      <p
                        key={track.id ?? trackIndex}
                        className="flex min-w-0 items-center gap-2 text-[11px] text-black/50"
                      >
                        <span className="w-3 shrink-0 text-right tabular-nums text-black/25">
                          {trackIndex + 1}
                        </span>
                        <span className="truncate">{track.name ?? track.first}</span>
                        <span className="truncate text-black/30">
                          - {track.second ?? formatArtists(track.ar)}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={<ChartNoAxesColumnIncreasing className="h-6 w-6" />}
            title={i18n._(msg`暂无榜单`)}
          />
        </div>
      )}
    </div>
  )
}
