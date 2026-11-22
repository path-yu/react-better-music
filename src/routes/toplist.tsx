import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Loader2,
  Pause,
  Play,
} from 'lucide-react'
import { Skeleton } from '@pikoloo/darwin-ui'
import { EmptyState } from '../components/common/EmptyState'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { PageHeader } from '../components/common/PageHeader'
import { fetchPlaylistTracks, fetchRemainingPlaylistTracks, fetchToplists } from '../api'
import { cn, formatArtists, formatNumber } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import { usePlayerStore } from '../store/player'
import type { Toplist } from '../types'

export const Route = createFileRoute('/toplist')({
  component: ToplistPage,
})

/** "更新14首" -> "更新 14 首", matching the spacing used everywhere else. */
function formatFrequency(value?: string) {
  return value?.replace(/(\D)(\d+)(\D)/, '$1 $2 $3').trim() ?? ''
}

/**
 * Play / pause a whole chart from its cover. Charts are at most a few hundred
 * tracks, so this loads them all, like the detail page's 播放全部.
 */
function useChartPlayback() {
  const { i18n } = useLingui()
  const playlistId = usePlayerStore((state) => state.playlistId)
  const playing = usePlayerStore((state) => state.playing)
  const [loadingId, setLoadingId] = useState<number | null>(null)

  const isPlaying = (list: Toplist) => playing && playlistId === String(list.id)

  const toggle = async (list: Toplist) => {
    const player = usePlayerStore.getState()
    if (player.playlistId === String(list.id) && player.queue.length) {
      void player.togglePlay()
      return
    }
    if (loadingId !== null) return
    setLoadingId(list.id)
    try {
      const first = await fetchPlaylistTracks(list.id)
      const rest =
        list.trackCount && list.trackCount > first.length
          ? (await fetchRemainingPlaylistTracks(list.id, list.trackCount)).songs
          : []
      const songs = [...first, ...rest]
      if (!songs.length) {
        toast.warning(i18n._(msg`暂无可播放歌曲`))
        return
      }
      await usePlayerStore.getState().initQueue(songs, 0, String(list.id))
    } catch {
      toast.error(i18n._(msg`歌单加载失败`))
    } finally {
      setLoadingId(null)
    }
  }

  return { isPlaying, isLoading: (list: Toplist) => loadingId === list.id, toggle }
}

type ChartPlayback = ReturnType<typeof useChartPlayback>

/** Round play button that sits on a cover and shows on hover / focus. */
function CoverPlayButton({
  list,
  playback,
  size = 'md',
}: {
  list: Toplist
  playback: ChartPlayback
  size?: 'sm' | 'md'
}) {
  const { i18n } = useLingui()
  const playing = playback.isPlaying(list)
  const loading = playback.isLoading(list)
  const label = playing
    ? i18n._(msg`暂停`)
    : i18n._(msg`播放「${list.name}」`)
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        void playback.toggle(list)
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'pressable absolute bottom-2 right-2 flex items-center justify-center rounded-full bg-white/90 text-black shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)] backdrop-blur-md transition-[opacity,transform] duration-200',
        size === 'sm' ? 'h-8 w-8' : 'h-9 w-9',
        // Stays visible while this chart is the one playing or loading.
        playing || loading
          ? 'opacity-100'
          : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 max-md:translate-y-0 max-md:opacity-100',
      )}
    >
      {loading ? (
        <Loader2 className={cn(icon, 'animate-spin')} />
      ) : playing ? (
        <Pause className={cn(icon, 'fill-current')} />
      ) : (
        <Play className={cn(icon, 'translate-x-px fill-current')} />
      )}
    </button>
  )
}

function PlayCountBadge({ count }: { count?: number }) {
  if (!count) return null
  return (
    <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm">
      <Play className="h-2.5 w-2.5 fill-current" />
      {formatNumber(count)}
    </span>
  )
}

/** Cards are divs (not buttons) because they contain the play button. */
function cardKeyHandler(open: () => void) {
  return (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
}

/**
 * The official charts come with a top-3 preview. Vertical cards, five across
 * on wide windows, so the five charts fill one row instead of leaving a hole
 * in a two-column grid.
 */
function OfficialChartCard({
  list,
  index,
  playback,
  onOpen,
}: {
  list: Toplist
  index: number
  playback: ChartPlayback
  onOpen: () => void
}) {
  const frequency = formatFrequency(list.updateFrequency)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={cardKeyHandler(onOpen)}
      className="apple-card apple-card-hover group flex min-w-0 cursor-pointer flex-col p-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_8px_22px_-14px_rgba(0,0,0,0.4)]">
          <ImageWithFallback
            src={list.coverImgUrl}
            alt={list.name}
            rounded="rounded-[10px]"
            resize="160y160"
            priority={index < 5}
            className="h-full w-full"
            imageClassName="transition-transform duration-500 group-hover:scale-[1.05]"
          />
          <CoverPlayButton list={list} playback={playback} size="sm" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink-1 transition-colors group-hover:text-accent">
            {list.name}
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-4">
            {frequency ? <span className="truncate">{frequency}</span> : null}
            {frequency && list.playCount ? <span aria-hidden="true">·</span> : null}
            {list.playCount ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                {formatNumber(list.playCount)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <ol className="mt-3 space-y-2 border-t border-[var(--app-border)] pt-3">
        {list.tracks?.slice(0, 3).map((track, trackIndex) => (
          <li key={track.id ?? trackIndex} className="flex min-w-0 gap-2.5">
            <span
              className={cn(
                'w-3 shrink-0 pt-px text-right text-[13px] font-semibold tabular-nums',
                trackIndex === 0 ? 'text-accent' : 'text-ink-3',
              )}
            >
              {trackIndex + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-1">
                {track.name ?? track.first}
              </span>
              <span className="block truncate text-[12px] text-ink-4">
                {track.second ?? formatArtists(track.ar)}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <span className="mt-3 flex items-center gap-0.5 self-end text-[11px] text-ink-4 transition-colors group-hover:text-accent">
        <Trans>完整榜单</Trans>
        <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** Everything else: a cover grid, like the playlist pages. */
function ChartTile({
  list,
  playback,
  onOpen,
}: {
  list: Toplist
  playback: ChartPlayback
  onOpen: () => void
}) {
  const frequency = formatFrequency(list.updateFrequency)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={cardKeyHandler(onOpen)}
      title={list.description || undefined}
      className="group flex cursor-pointer flex-col gap-2 rounded-[10px] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_14px_-6px_rgba(0,0,0,0.18)] transition-shadow duration-500 group-hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_14px_30px_-10px_rgba(0,0,0,0.28)]">
        <ImageWithFallback
          src={list.coverImgUrl}
          alt={list.name}
          rounded="rounded-[10px]"
          resize="250y250"
          className="h-full w-full transform-gpu transition-transform duration-[650ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.035] motion-reduce:transform-none"
        />
        <PlayCountBadge count={list.playCount} />
        <CoverPlayButton list={list} playback={playback} size="sm" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink-1 transition-colors group-hover:text-accent">
          {list.name}
        </p>
        {frequency ? (
          <p className="mt-0.5 truncate text-[12px] text-ink-4">{frequency}</p>
        ) : null}
      </div>
    </div>
  )
}

const TILE_GRID =
  'grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-7'
const OFFICIAL_GRID =
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'

function ToplistPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const playback = useChartPlayback()
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

  // Only the official charts come with a track preview. Mixing them with the
  // other 60 in one list of big cards left most cards half empty and made the
  // page several screens of near-identical boxes.
  const official = lists.filter((list) => list.tracks?.length)
  const others = lists.filter((list) => !list.tracks?.length)

  return (
    <div className="page">
      <PageHeader
        eyebrow={<Trans>发现音乐</Trans>}
        title={<Trans>排行榜</Trans>}
        description={<Trans>云音乐官方榜单，实时更新</Trans>}
        actions={
          !loading && !failed && lists.length ? (
            <p className="text-[11px] text-ink-4">
              <Trans>共 {lists.length} 张榜单</Trans>
            </p>
          ) : null
        }
      />

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
        <>
          <div className={cn('mt-6', OFFICIAL_GRID)}>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[248px] w-full rounded-[18px]" />
            ))}
          </div>
          <div className={cn('mt-10', TILE_GRID)}>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square w-full rounded-[10px]" />
            ))}
          </div>
        </>
      ) : lists.length ? (
        <>
          {official.length ? (
            <section className="mt-6" aria-labelledby="toplist-official">
              <h2 id="toplist-official" className="section-title mb-3.5">
                <Trans>官方榜</Trans>
              </h2>
              <div className={OFFICIAL_GRID}>
                {official.map((list, index) => (
                  <OfficialChartCard
                    key={list.id}
                    list={list}
                    index={index}
                    playback={playback}
                    onOpen={() => openChart(list)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {others.length ? (
            <section
              className={official.length ? 'mt-10' : 'mt-6'}
              aria-labelledby="toplist-more"
            >
              <h2 id="toplist-more" className="section-title mb-3.5">
                {official.length ? <Trans>更多榜单</Trans> : <Trans>全部榜单</Trans>}
              </h2>
              <div className={TILE_GRID}>
                {others.map((list) => (
                  <ChartTile
                    key={list.id}
                    list={list}
                    playback={playback}
                    onOpen={() => openChart(list)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
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
