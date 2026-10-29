import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from '@pikoloo/darwin-ui'
import { PlaylistCard } from '../../components/cards/PlaylistCard'
import { EmptyState } from '../../components/common/EmptyState'
import { fetchPlaylistTags, fetchTopPlaylists } from '../../api'
import { getArrLast, cn } from '../../lib/format'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'
import { TAG_LABELS } from '../../lib/tagLabels'
import type { Playlist } from '../../types'

export const Route = createFileRoute('/songlists/')({
  component: SonglistsPage,
})

function SonglistsPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`推荐歌单`))
  const [tags, setTags] = useState<string[]>(['全部'])
  const [activeTag, setActiveTag] = useState('全部')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [more, setMore] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [canScrollTagsLeft, setCanScrollTagsLeft] = useState(false)
  const [canScrollTagsRight, setCanScrollTagsRight] = useState(false)
  const tagScrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = tagScrollerRef.current
    if (!element) return
    const updateScrollState = () => {
      setCanScrollTagsLeft(element.scrollLeft > 4)
      setCanScrollTagsRight(
        element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
      )
    }
    updateScrollState()
    element.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [tags.length])

  const selectTag = (tag: string, closeMenu = false) => {
    setActiveTag(tag)
    if (closeMenu) setTagMenuOpen(false)
    const buttons = tagScrollerRef.current?.querySelectorAll<HTMLButtonElement>('[data-tag]')
    buttons?.forEach((button) => {
      if (button.dataset.tag === tag) {
        button.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    })
  }

  useEffect(() => {
    fetchPlaylistTags()
      .then((list) => setTags(['全部', ...list.map((item) => item.name)]))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setPlaylists([])
    fetchTopPlaylists({ cat: activeTag, limit: 40 })
      .then((result) => {
        if (cancelled) return
        setPlaylists(result.playlists)
        setMore(result.more)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        toast.error(i18n._(msg`歌单加载失败`))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTag, attempt])

  const retry = () => setAttempt((value) => value + 1)

  const loadMore = async () => {
    const last = getArrLast(playlists)
    if (!last || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await fetchTopPlaylists({
        cat: activeTag,
        limit: 20,
        before: last.updateTime,
      })
      setPlaylists((prev) => [...prev, ...result.playlists])
      setMore(result.more)
    } catch {
      toast.error(i18n._(msg`加载更多失败`))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="px-8 pb-14 pt-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="headline-lg">
            <Trans>推荐歌单</Trans>
          </h1>
          <p className="mt-1.5 text-[12px] text-black/35">
            <Trans>编辑精选的华语、欧美与器乐歌单</Trans>
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-[11px] text-black/40">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <Trans>精品歌单</Trans>
        </span>
      </div>

      <div className="sticky top-0 z-20 -mx-8 mt-5 bg-white/88 px-8 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={i18n._(msg`向左浏览分类`)}
            disabled={!canScrollTagsLeft}
            onClick={() =>
              tagScrollerRef.current?.scrollBy({ left: -260, behavior: 'smooth' })
            }
            className={cn(
              'pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/45 hover:text-black/75 max-md:h-9 max-md:w-9',
              !canScrollTagsLeft && 'pointer-events-none opacity-25',
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div
            ref={tagScrollerRef}
            className="tag-scroller flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                data-tag={tag}
                onClick={() => selectTag(tag)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-[11.5px] transition-colors',
                  activeTag === tag
                    ? 'bg-accent text-white'
                    : 'border border-black/8 bg-[#f5f5f7] text-black/55 hover:bg-[#ececf0] hover:text-black/75',
                )}
              >
                {tag === '全部'
                  ? i18n._(msg`全部`)
                  : TAG_LABELS[tag]
                    ? i18n._(TAG_LABELS[tag])
                    : tag}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label={i18n._(msg`向右浏览分类`)}
            disabled={!canScrollTagsRight}
            onClick={() =>
              tagScrollerRef.current?.scrollBy({ left: 260, behavior: 'smooth' })
            }
            className={cn(
              'pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/45 hover:text-black/75 max-md:h-9 max-md:w-9',
              !canScrollTagsRight && 'pointer-events-none opacity-25',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          <Popover open={tagMenuOpen} onOpenChange={setTagMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="pressable flex h-7 shrink-0 items-center gap-1 rounded-full border border-black/8 bg-white px-2.5 text-[11px] text-black/55 hover:text-black/80"
              >
                <Trans>更多</Trans>
                <ChevronDown className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={8}
              glass
              className="w-[min(380px,calc(100vw-24px))] max-w-[calc(100vw-24px)] p-3"
            >
              <p className="text-[11px] text-black/35">
                <Trans>全部分类</Trans>
              </p>
              <div className="mt-2 flex max-h-[300px] flex-wrap gap-1.5 overflow-y-auto">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => selectTag(tag, true)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                      activeTag === tag
                        ? 'bg-accent text-white'
                        : 'bg-[#f5f5f7] text-black/55 hover:bg-[#ececf0] hover:text-black/75',
                    )}
                  >
                    {tag === '全部'
                      ? i18n._(msg`全部`)
                      : TAG_LABELS[tag]
                        ? i18n._(TAG_LABELS[tag])
                        : tag}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {failed ? (
        <EmptyState
          variant="error"
          title={i18n._(msg`歌单加载失败`)}
          description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
          onRetry={retry}
        />
      ) : loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 15 }).map((_, index) => (
            <div key={index} className="apple-card p-2.5">
              <Skeleton className="aspect-square w-full rounded-[10px]" />
              <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {playlists.map((playlist, index) => (
            <PlaylistCard
              key={`${playlist.id}-${playlist.updateTime ?? ''}`}
              playlist={playlist}
              priority={index < 10}
            />
          ))}
        </div>
      )}

      {!loading && more && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full px-5 text-[11.5px]"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            <Trans>加载更多</Trans>
          </Button>
        </div>
      )}
    </div>
  )
}
