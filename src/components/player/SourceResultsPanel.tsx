import { useEffect, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Check, RefreshCw } from 'lucide-react'
import { fetchSourceCandidates, type SourceCandidate, type VideoSource } from '../../api'
import { usePlayerStore } from '../../store/player'
import { cn, formatDuration, formatNumber } from '../../lib/format'
import { apiUrl } from '../../lib/http'
import { toast } from '../../lib/toast'

/**
 * "播放源" tab: every video candidate the matcher found for the current song.
 * Clicking one plays that exact video; the previous video cache is dropped by
 * the store, so only a single recording is kept per song.
 */
export function SourceResultsPanel({ source }: { source: VideoSource }) {
  const { i18n } = useLingui()
  const currentSong = usePlayerStore(
    (state) => state.queue[state.currentIndex],
  )
  const switching = usePlayerStore((state) => state.switchingSource)
  const switchToVideoCandidate = usePlayerStore(
    (state) => state.switchToVideoCandidate,
  )
  const [items, setItems] = useState<SourceCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const songId = currentSong?.id

  useEffect(() => {
    if (!songId) return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    fetchSourceCandidates(songId, source, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setItems(list)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFailed(true)
        setItems([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [songId, source, attempt])

  const currentUrl = currentSong?.matchedWebUrl ?? ''

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 px-2 pb-2 pt-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-white/85">
            <Trans>播放源</Trans>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/40">
            {source === 'bilibili' ? 'Bilibili' : 'YouTube'}
            <span className="text-white/25">·</span>
            {loading
              ? i18n._(msg`正在查找…`)
              : i18n._(msg`${items.length} 个结果`)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={loading}
          className="pressable flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 text-[11px] text-white/70 transition-colors hover:bg-white/16 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          <Trans>刷新</Trans>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {loading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-[10px] px-2 py-2"
              >
                <div className="h-[42px] w-[74px] shrink-0 animate-pulse rounded-[6px] bg-white/10" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/8" />
                </div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <p className="px-3 py-8 text-center text-[12px] text-white/45">
            <Trans>播放源加载失败</Trans>
          </p>
        ) : items.length ? (
          <div className="space-y-1">
            {items.map((item) => {
              const active = Boolean(currentUrl) && currentUrl === item.webUrl
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={switching}
                  onClick={() =>
                    void switchToVideoCandidate(
                      source,
                      item.id,
                      item.webUrl,
                    ).catch(() => toast.warning(i18n._(msg`切换播放源失败，请稍后再试`)))
                  }
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors disabled:opacity-60',
                    active ? 'bg-white/14' : 'hover:bg-white/8',
                  )}
                >
                  <span className="relative h-[42px] w-[74px] shrink-0 overflow-hidden rounded-[6px] bg-white/10">
                    <img
                      // bilibili refuses hotlinked images without a referer;
                      // the local proxy adds it.
                      src={
                        item.cover
                          ? apiUrl('/image/proxy', { url: item.cover })
                          : ''
                      }
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/65 px-1 py-0.5 text-[10px] leading-none text-white/90">
                      {formatDuration(item.duration * 1000)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12px] leading-snug text-white/85">
                      {item.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/40">
                      <span className="min-w-0 truncate">{item.author}</span>
                      <span className="shrink-0 tabular-nums">
                        {i18n._(msg`${formatNumber(item.views)} 播放`)}
                      </span>
                    </span>
                  </span>
                  {active ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="px-3 py-8 text-center text-[12px] text-white/45">
            <Trans>没有找到可用的视频源</Trans>
          </p>
        )}
      </div>
    </div>
  )
}
