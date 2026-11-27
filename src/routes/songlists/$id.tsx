import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Heart,
  Pencil,
  RefreshCw,
  Share2,
  Star,
} from 'lucide-react'
import {
  Avatar,
  Button,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { SearchInput } from '../../components/common/SearchInput'
import { EmptyState } from '../../components/common/EmptyState'
import { ExpandableDescription } from '../../components/common/ExpandableDescription'
import { PlaylistCard } from '../../components/cards/PlaylistCard'
import { TAG_LABELS } from '../../lib/tagLabels'
import { SongTable } from '../../components/songs/SongTable'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { UnblockFilterButton } from '../../components/songs/UnblockFilterButton'
import { CommentSection } from '../../components/comments/CommentSection'
import {
  fetchPlaylistDetail,
  fetchPlaylistRecommendations,
  fetchPlaylistTracks,
  fetchRemainingPlaylistTracks,
  removeSongFromPlaylist,
  searchArtists,
  updatePlaylistSubscribe,
} from '../../api'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { toast } from '../../lib/toast'
import { invalidateApiCache } from '../../lib/http'
import { useDocumentTitle } from '../../lib/title'
import { formatDate, formatNumber, matchesKeyword } from '../../lib/format'
import { useUnblockFilter } from '../../lib/useUnblockFilter'
import { needsUnblock } from '../../lib/songs'
import type { Playlist, Song } from '../../types'

export const Route = createFileRoute('/songlists/$id')({
  component: PlaylistDetailRoute,
})

function PlaylistDetailRoute() {
  const { id } = Route.useParams()
  // A new playlist id must get a fresh tab state. Without this key, the
  // previous tab was persisted under the new id before the restore effect ran.
  return <PlaylistDetailPage key={id} />
}

function PlaylistDetailPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Playlist | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [tracksReady, setTracksReady] = useState(false)
  const tabStorageKey = `songlist-tab:${id}`
  const [tab, setTab] = useState(
    () => sessionStorage.getItem(tabStorageKey) ?? 'songs',
  )
  const [keyword, setKeyword] = useState('')
  /** Keep only rows NetEase cannot play directly (无版权 / 其它版本可播). */
  const [unblockOnly, setUnblockOnly] = useUnblockFilter(`songlist:${id}`)
  const [subscribing, setSubscribing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [recommended, setRecommended] = useState<{
    title: string
    playlists: Playlist[]
  } | null>(null)
  const [recommendationsLoading, setRecommendationsLoading] = useState(true)
  useDocumentTitle(detail?.name ?? i18n._(msg`歌单`))

  // The route remounts when returning from a user profile. Keep the selected
  // pane per playlist so comments do not fall back to the song list.
  useEffect(() => {
    sessionStorage.setItem(tabStorageKey, tab)
  }, [tab, tabStorageKey])

  useEffect(() => {
    setTab(sessionStorage.getItem(tabStorageKey) ?? 'songs')
  }, [tabStorageKey])

  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const canEditPlaylist = Boolean(
    profile?.userId && detail?.creator.userId === profile.userId,
  )
  const loadPlaylists = useUserStore((state) => state.loadPlaylists)
  const localSubscribedPlaylists = useLocalLibraryStore(
    (state) => state.subscribedPlaylists,
  )
  const toggleLocalSubscribedPlaylist = useLocalLibraryStore(
    (state) => state.toggleSubscribedPlaylist,
  )
  const cacheLocalSubscribedPlaylist = useLocalLibraryStore(
    (state) => state.cacheSubscribedPlaylist,
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setDetail(null)
    setSongs([])
    setTracksReady(false)
    setKeyword('')
    // The 「仅看可换源」 switch is restored from sessionStorage by
    // `useUnblockFilter`; resetting it here would wipe that on every remount
    // (the route mounts again when you come back from another page).

    const load = async () => {
      try {
        // Detail and the first track page start together; remaining pages load
        // in the background with bounded concurrency.
        const [playlist, first] = await Promise.all([
          fetchPlaylistDetail(id, controller.signal),
          fetchPlaylistTracks(id, 300, 0, controller.signal),
        ])
        if (controller.signal.aborted) return
        setDetail(playlist)
        setSongs(first)
        setLoading(false)
        if (playlist.trackCount > first.length) {
          const { songs: rest, failedPages } = await fetchRemainingPlaylistTracks(
            id,
            playlist.trackCount,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setSongs([...first, ...rest])
          if (failedPages > 0) {
            // Failed pages are not cached, so 刷新 fetches exactly what is missing.
            const missing = Math.max(0, playlist.trackCount - first.length - rest.length)
            toast.warning(
              missing > 0
                ? i18n._(msg`有 ${missing} 首歌曲加载失败，可点击「刷新」重试`)
                : i18n._(msg`部分歌曲加载失败，可点击「刷新」重试`),
            )
          }
        }
      } catch {
        if (controller.signal.aborted) return
        toast.error(i18n._(msg`歌单加载失败`))
        setLoading(false)
      } finally {
        // The count must only be published after every page has settled,
        // otherwise the first page briefly shows a smaller number.
        if (!controller.signal.aborted) setTracksReady(true)
      }
    }
    void load()

    return () => controller.abort()
  }, [id, refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    setRecommendationsLoading(true)
    setRecommended(null)
    void fetchPlaylistRecommendations(id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRecommended(result)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRecommended({ title: '', playlists: [] })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecommendationsLoading(false)
      })
    return () => controller.abort()
  }, [id])

  // Guests who favorited this playlist before track snapshots were stored get
  // backfilled automatically as soon as the detail page has song data.
  useEffect(() => {
    if (isLogin || !detail || songs.length === 0) return
    const existing = localSubscribedPlaylists.find(
      (playlist) => Number(playlist.id) === Number(detail.id),
    )
    if (!existing || (existing.songs?.length ?? 0) >= songs.length) return
    void cacheLocalSubscribedPlaylist({ ...detail, songs })
  }, [
    isLogin,
    detail,
    songs,
    localSubscribedPlaylists,
    cacheLocalSubscribedPlaylist,
  ])

  const collectPlaylistSongs = async () => {
    const collected = new Map<number, Song>()
    for (const song of songs) collected.set(song.id, song)
    if (!detail) return [...collected.values()]

    let offset = songs.length
    const target = Math.max(detail.trackCount || 0, offset)
    while (offset < target) {
      const page = await fetchPlaylistTracks(detail.id, 300, offset)
      if (page.length === 0) break
      offset += page.length
      for (const song of page) collected.set(song.id, song)
    }
    return [...collected.values()]
  }

  const unblockCount = useMemo(
    () => (tracksReady ? songs.filter(needsUnblock).length : null),
    [songs, tracksReady],
  )

  const filteredSongs = useMemo(() => {
    const searched = keyword.trim()
      ? songs.filter((song) =>
          matchesKeyword(
            keyword,
            song.name,
            song.al.name,
            song.ar.map((artist) => artist.name).join(' '),
          ),
        )
      : songs
    return unblockOnly ? searched.filter(needsUnblock) : searched
  }, [keyword, songs, unblockOnly])

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
            <Skeleton className="mt-5 h-9 w-[240px] rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-8 h-[300px] w-full rounded-[18px]" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="page">
        <EmptyState
          title={i18n._(msg`歌单不存在或无法访问`)}
          action={
            <Button
              variant="primary"
              size="sm"
              className="rounded-full"
              onClick={() => void navigate({ to: '/songlists' })}
            >
              {i18n._(msg`返回推荐歌单`)}
            </Button>
          }
        />
      </div>
    )
  }

  const isOwner = Boolean(profile && profile.userId === detail.creator?.userId)
  const localSubscribed = localSubscribedPlaylists.some(
    (playlist) => Number(playlist.id) === Number(detail.id),
  )
  const subscribed = isLogin ? Boolean(detail.subscribed) : localSubscribed
  const subscribedCount = Math.max(
    0,
    (detail.subscribedCount ?? 0) +
      (!isLogin && localSubscribed && !detail.subscribed ? 1 : 0),
  )

  const handleSubscribe = async () => {
    // Guests can keep playlists in the local file library; only the online
    // subscription path requires a NetEase session.
    if (!isLogin) {
      setSubscribing(true)
      try {
        // A subscribed playlist must remain usable offline, so persist the
        // complete track snapshot (not just the playlist card metadata). If a
        // page fetch fails, keep the tracks already loaded rather than losing
        // the favorite action entirely.
        let tracks = songs
        if (!localSubscribed) {
          try {
            tracks = await collectPlaylistSongs()
          } catch {
            tracks = songs
          }
        }
        const next = await toggleLocalSubscribedPlaylist({
          ...detail,
          songs: tracks,
        })
        if (next !== null) {
          toast.success(
            next ? i18n._(msg`收藏成功`) : i18n._(msg`已取消收藏`),
          )
        }
      } finally {
        setSubscribing(false)
      }
      return
    }
    setSubscribing(true)
    const subscribe = !detail.subscribed
    try {
      const res = await updatePlaylistSubscribe({ id: detail.id, t: subscribe ? 1 : 2 })
      if (res.code !== 200) {
        toast.error(
          subscribe ? i18n._(msg`收藏失败`) : i18n._(msg`取消收藏失败`),
        )
        return
      }
      setDetail({
        ...detail,
        subscribed: subscribe,
        subscribedCount: Math.max(0, (detail.subscribedCount ?? 0) + (subscribe ? 1 : -1)),
      })
      if (profile?.userId) await loadPlaylists(profile.userId)
      toast.success(
        subscribe ? i18n._(msg`收藏成功`) : i18n._(msg`已取消收藏`),
      )
    } catch {
      toast.error(i18n._(msg`操作失败`))
    } finally {
      setSubscribing(false)
    }
  }

  const handleShare = async () => {
    // Local dev and the desktop shells serve the app from localhost / a private
    // protocol: the address bar URL only works on this machine. Fall back to
    // the canonical NetEase page, which opens for anyone (web and the app).
    const { protocol, hostname } = window.location
    const localHost =
      !/^https?:$/.test(protocol) ||
      ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)
    const url = localHost
      ? `https://music.163.com/#/playlist?id=${detail.id}`
      : window.location.href
    try {
      await navigator.clipboard.writeText(url)
      toast.success(
        localHost
          ? i18n._(msg`已复制网易云歌单链接`)
          : i18n._(msg`链接已复制`),
      )
    } catch {
      toast.warning(i18n._(msg`复制链接失败`))
    }
  }

  const openCreator = async () => {
    const creator = detail.creator
    if (!creator) return
    if (creator.artistId) {
      void navigate({
        to: '/artist/$id',
        params: { id: String(creator.artistId) },
      })
      return
    }
    // Some artist accounts don't expose an artistId on the creator object.
    // For authenticated creator types, resolve an exact artist match before
    // falling back to the normal user profile.
    if (creator.userType && creator.userType !== 0) {
      try {
        const artists = await searchArtists(creator.nickname)
        const match = artists.find(
          (artist) =>
            artist.name === creator.nickname ||
            artist.alias?.includes(creator.nickname),
        )
        if (match) {
          void navigate({
            to: '/artist/$id',
            params: { id: String(match.id) },
          })
          return
        }
      } catch {
        // Fall through to the user profile if artist lookup fails.
      }
    }
    if (creator.userId) {
      void navigate({
        to: '/users/$id',
        params: { id: String(creator.userId) },
      })
    }
  }

  return (
    <div className="page">
      <button
        type="button"
        onClick={() => {
          // Playlists open from the index, search, home, artist pages and the
          // sidebar, so return to the referring page; a direct link has no app
          // history and falls back to the playlist index.
          if (window.history.length > 1) window.history.back()
          else void navigate({ to: '/songlists' })
        }}
        aria-label={i18n._(msg`返回`)}
        title={i18n._(msg`返回`)}
        className="pressable mb-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-1 dark:hover:bg-white/10"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="flex gap-6 max-sm:flex-col max-sm:gap-4">
        <ImageWithFallback
          src={detail.coverImgUrl}
          alt={detail.name}
          rounded="rounded-[18px]"
          className="artwork-shadow h-[208px] w-[208px] shrink-0 max-sm:h-[160px] max-sm:w-[160px]"
          resize="400y400"
          priority
        />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-accent/8 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            <Trans>歌单</Trans>
          </span>
          <div className="mt-2.5 flex items-center gap-2.5">
            <h1 className="headline-lg line-clamp-2">{detail.name}</h1>
            {isOwner ? (
              <button
                type="button"
                aria-label={i18n._(msg`编辑歌单`)}
                onClick={() =>
                  void navigate({
                    to: '/songlists/$id/edit',
                    params: { id: String(detail.id) },
                  })
                }
                className="pressable rounded-full p-1.5 text-ink-4 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
            <button
              type="button"
              onClick={() => void openCreator()}
              className="pressable flex items-center gap-1.5 rounded-full transition-colors hover:bg-black/[0.04]"
            >
              <Avatar
                src={detail.creator?.avatarUrl}
                alt={detail.creator?.nickname}
                size="xs"
              />
              <span className="font-medium text-accent hover:underline">
                {detail.creator?.nickname}
              </span>
            </button>
            {detail.createTime ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                <Trans>{formatDate(detail.createTime)} 创建</Trans>
              </span>
            ) : null}
            <span>
              <Trans>{detail.trackCount} 首歌曲</Trans>
            </span>
            <span>
              <Trans>{formatNumber(detail.playCount)} 次播放</Trans>
            </span>
          </div>

          {detail.tags?.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-4">
                <Trans>标签</Trans>
              </span>
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-black/8 px-2 py-0.5 text-[11px] text-ink-3"
                >
                  {TAG_LABELS[tag] ? i18n._(TAG_LABELS[tag]) : tag}
                </span>
              ))}
            </div>
          ) : null}

          {detail.description ? (
            <ExpandableDescription
              text={detail.description}
              className="mt-2.5 max-w-[760px]"
            />
          ) : isOwner ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-accent"
              onClick={() =>
                void navigate({
                  to: '/songlists/$id/edit',
                  params: { id: String(detail.id) },
                })
              }
            >
              <Trans>添加简介</Trans>
            </button>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PlayAllButton songs={songs} playlistId={String(detail.id)} />
            {/* Icon-only: with five buttons the row wrapped "分享" onto a
                second line at ~1024px windows. */}
            <Button
              variant="secondary"
              size="sm"
              aria-label={i18n._(msg`刷新`)}
              title={i18n._(msg`刷新`)}
              className="rounded-full px-2.5 text-[12px]"
              onClick={() => {
                // Detail/track responses are cached for five minutes.
                invalidateApiCache([
                  '/playlist/detail',
                  '/playlist/track/all',
                ])
                setRefreshKey((value) => value + 1)
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              loading={subscribing}
              disabled={isOwner}
              onClick={() => void handleSubscribe()}
            >
              {subscribed ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Star className="mr-1.5 h-3.5 w-3.5" />
              )}
              {subscribed ? <Trans>已收藏</Trans> : <Trans>收藏</Trans>}
              <span className="ml-1 text-ink-4">
                {formatNumber(subscribedCount)}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              onClick={() => void handleShare()}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              <Trans>分享</Trans>
              <span className="ml-1 text-ink-4">{formatNumber(detail.shareCount ?? 0)}</span>
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-7">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-4 max-sm:flex-wrap max-sm:gap-2 border-b border-[var(--app-border)] sticky-bar py-2 page-bleed">
          <TabsList>
            <TabsTrigger value="songs">
              <Trans>歌曲列表</Trans>
              <span className="ml-1 text-[11px] text-ink-4">{songs.length}</span>
            </TabsTrigger>
            <TabsTrigger value="comments">
              <Trans>评论</Trans>
              <span className="ml-1 text-[11px] text-ink-4">
                <Trans>热议</Trans>
              </span>
            </TabsTrigger>
            <TabsTrigger value="related">
              <Trans>相似歌单</Trans>
              {recommended?.playlists.length ? (
                <span className="ml-1 text-[11px] text-ink-4">
                  {recommended.playlists.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
          {tab === 'songs' ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">
              <UnblockFilterButton
                count={unblockCount}
                active={unblockOnly}
                onToggle={() => setUnblockOnly((value) => !value)}
              />
              <SearchInput
                value={keyword}
                onChange={setKeyword}
                placeholder={i18n._(msg`搜索歌单歌曲`)}
                wrapperClassName="w-[190px] shrink-0 max-sm:w-full"
                className="rounded-full text-[12px]"
              />
            </div>
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          <SongTable
            songs={filteredSongs}
            playlistId={String(detail.id)}
            onRemoveFromPlaylist={
              canEditPlaylist
                ? async (song) => {
                    const response = await removeSongFromPlaylist(
                      detail.id,
                      song.id,
                    )
                    const code =
                      response.code ?? response.body?.code ?? response.status
                    if (code !== 200) throw new Error('remove failed')
                    setSongs((current) =>
                      current.filter((item) => item.id !== song.id),
                    )
                  }
                : undefined
            }
            stickyTop={57}
            emptyText={
              keyword
                ? i18n._(msg`没有匹配的歌曲`)
                : i18n._(msg`歌单暂时没有歌曲`)
            }
          />
        </TabsContent>

        <TabsContent value="comments" className="mt-6">
          <CommentSection
            type={2}
            resourceId={Number(detail.id)}
            title={i18n._(msg`听友评论`)}
          />
        </TabsContent>

        <TabsContent value="related" className="mt-6">
          {recommendationsLoading ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-square w-full rounded-[10px]" />
                  <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : recommended?.playlists.length ? (
            <div>
              <div className="mb-4 flex items-end justify-between">
                <h2 className="section-title">
                  {recommended.title || i18n._(msg`相似歌单`)}
                </h2>
                <span className="text-[11px] tabular-nums text-ink-4">
                  {recommended.playlists.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {recommended.playlists.map((playlist, index) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    priority={index < 5}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title={i18n._(msg`暂无相似歌单`)} />
          )}
        </TabsContent>
      </Tabs>

      {detail.isMyLike ? (
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-ink-4">
          <Heart className="h-3 w-3 text-love" />
          <Trans>这是你的「我喜欢的音乐」</Trans>
        </p>
      ) : null}
    </div>
  )
}
