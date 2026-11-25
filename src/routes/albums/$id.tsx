import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, Building2, CalendarDays, Check, Star } from 'lucide-react'
import {
  Button,
  Input,
  Skeleton,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import { ExpandableDescription } from '../../components/common/ExpandableDescription'
import { ArtistLinks } from '../../components/common/ArtistLinks'
import { SongTable } from '../../components/songs/SongTable'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { fetchAlbumDetail, subscribeAlbum } from '../../api'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useUserStore } from '../../store/user'
import type { AlbumDetail } from '../../types'
import { formatDate, matchesKeyword } from '../../lib/format'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'

export const Route = createFileRoute('/albums/$id')({
  component: AlbumDetailPage,
})

function AlbumDetailPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const isLogin = useUserStore((state) => state.isLogin)
  const localAlbums = useLocalLibraryStore((state) => state.subscribedAlbums)
  const toggleLocalAlbum = useLocalLibraryStore(
    (state) => state.toggleSubscribedAlbum,
  )
  const [subscribed, setSubscribed] = useState(false)
  const [subscribeBusy, setSubscribeBusy] = useState(false)
  useDocumentTitle(album?.name ?? i18n._(msg`专辑`))

  // Guests collect into the local library, the signed-in account into NetEase;
  // re-derive the state whenever either side changes (login, id, local edits).
  useEffect(() => {
    if (!album) return
    setSubscribed(
      isLogin
        ? Boolean(album.isSub)
        : localAlbums.some((item) => Number(item.id) === Number(album.id)),
    )
  }, [album, isLogin, localAlbums])

  const handleToggleSubscribe = async () => {
    if (!album || subscribeBusy) return
    setSubscribeBusy(true)
    const next = !subscribed
    try {
      if (isLogin) {
        if (!(await subscribeAlbum(album.id, next))) {
          throw new Error('album/sub failed')
        }
        setAlbum((current) =>
          current ? { ...current, isSub: next } : current,
        )
        setSubscribed(next)
        // Keep the sidebar's "收藏的专辑" in step without a reload.
        void useUserStore.getState().loadCollectedAlbums()
      } else {
        const result = await toggleLocalAlbum(album)
        if (result === null) return
        setSubscribed(result)
      }
      toast.success(next ? i18n._(msg`已收藏`) : i18n._(msg`已取消收藏`))
    } catch {
      toast.error(i18n._(msg`操作失败`))
    } finally {
      setSubscribeBusy(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setAlbum(null)
    setKeyword('')

    void fetchAlbumDetail(id)
      .then((detail) => {
        if (!controller.signal.aborted) setAlbum(detail)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          toast.error(i18n._(msg`专辑加载失败`))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [id])

  const songs = album?.songs ?? []

  const filteredSongs = useMemo(() => {
    if (!keyword.trim()) return songs
    return songs.filter((song) =>
      matchesKeyword(
        keyword,
        song.name,
        song.al?.name,
        song.ar.map((artist) => artist.name).join(' '),
      ),
    )
  }, [keyword, songs])

  if (loading) {
    return (
      <div className="page">
        <div className="flex gap-6 max-sm:flex-col max-sm:gap-4">
          <Skeleton className="h-[208px] w-[208px] shrink-0 rounded-[18px] max-sm:h-[160px] max-sm:w-[160px]" />
          <div className="flex-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="mt-3 h-8 w-[42%] rounded-full" />
            <Skeleton className="mt-4 h-3 w-[260px] rounded-full" />
            <Skeleton className="mt-3 h-3 w-[70%] rounded-full" />
            <Skeleton className="mt-5 h-9 w-[200px] rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-8 h-[300px] w-full rounded-[18px]" />
      </div>
    )
  }

  if (!album) {
    return (
      <div className="page">
        <EmptyState
          title={i18n._(msg`专辑不存在或无法访问`)}
          action={
            <Button
              variant="primary"
              size="sm"
              className="rounded-full"
              onClick={() => window.history.back()}
            >
              {i18n._(msg`返回上一页`)}
            </Button>
          }
        />
      </div>
    )
  }

  const artists = album.artists?.length
    ? album.artists
    : album.artist
      ? [album.artist]
      : []
  const description = album.description || album.briefDesc

  return (
    <div className="page">
      <button
        type="button"
        onClick={() => {
          // Direct links have no app history to pop; fall back to discover.
          if (window.history.length > 1) window.history.back()
          else void navigate({ to: '/' })
        }}
        aria-label={i18n._(msg`返回`)}
        title={i18n._(msg`返回`)}
        className="pressable mb-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-1 dark:hover:bg-white/10"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="flex gap-6 max-sm:flex-col max-sm:gap-4">
        <ImageWithFallback
          src={album.picUrl}
          alt={album.name}
          rounded="rounded-[18px]"
          className="artwork-shadow h-[208px] w-[208px] shrink-0 max-sm:h-[160px] max-sm:w-[160px]"
          resize="400y400"
          priority
        />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-accent/8 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            <Trans>专辑</Trans>
          </span>
          <h1 className="headline-lg mt-2.5 line-clamp-2">{album.name}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-3">
            <ArtistLinks artists={artists} className="font-medium text-accent" />
            {album.publishTime ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                <Trans>{formatDate(album.publishTime)} 发行</Trans>
              </span>
            ) : null}
            <span>
              <Trans>{songs.length} 首歌曲</Trans>
            </span>
            {album.company ? (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {album.company}
              </span>
            ) : null}
          </div>

          {description ? (
            <ExpandableDescription
              text={description}
              className="mt-2.5 max-w-[760px]"
            />
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PlayAllButton songs={songs} playlistId={`album-${album.id}`} />
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              onClick={() =>
                void navigate({
                  to: '/artist/$id',
                  params: {
                    id: String(artists[0]?.id ?? ''),
                  },
                })
              }
              disabled={!artists[0]?.id}
            >
              <Trans>查看歌手</Trans>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              disabled={subscribeBusy}
              onClick={() => void handleToggleSubscribe()}
            >
              {subscribed ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Star className="mr-1.5 h-3.5 w-3.5" />
              )}
              {subscribed ? <Trans>已收藏</Trans> : <Trans>收藏</Trans>}
            </Button>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 mt-7 flex items-center justify-between gap-4 max-sm:flex-wrap max-sm:gap-2 border-b border-[var(--app-border)] sticky-bar py-2 page-bleed">
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[12px] font-medium text-ink-2">
            <Trans>歌曲列表</Trans>
          </span>
          <span className="text-[11px] tabular-nums text-ink-4">
            {songs.length}
          </span>
        </div>
        <Input.Search
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={i18n._(msg`搜索专辑歌曲`)}
          size="sm"
          className="w-[190px] rounded-full text-[12px] max-sm:w-full"
        />
      </div>

      <div className="mt-3">
        <SongTable
          songs={filteredSongs}
          playlistId={`album-${album.id}`}
          stickyTop={57}
          hideAlbum
          emptyText={
            keyword
              ? i18n._(msg`没有匹配的歌曲`)
              : i18n._(msg`专辑暂时没有歌曲`)
          }
        />
      </div>
    </div>
  )
}
