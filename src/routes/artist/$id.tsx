import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, Check, Disc3, Music2, UserPlus, Video } from 'lucide-react'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Button } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import { ExpandableDescription } from '../../components/common/ExpandableDescription'
import { MvCard } from '../../components/cards/MvCard'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { SongTable } from '../../components/songs/SongTable'
import {
  fetchArtistAlbums,
  fetchArtistMvs,
  fetchArtistProfile,
  fetchArtistTopSongs,
  fetchSimilarArtists,
  subscribeArtist,
} from '../../api'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useUserStore } from '../../store/user'
import { formatDate, formatNumber } from '../../lib/format'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'
import type { ArtistAlbum, ArtistProfile, ArtistSummary, Mv, Song } from '../../types'

/** Tab ids double as the `?tab=` value so a deep link restores the tab. */
const ARTIST_TABS = ['songs', 'albums', 'mvs'] as const
type ArtistTab = (typeof ARTIST_TABS)[number]

export const Route = createFileRoute('/artist/$id')({
  validateSearch: (search: Record<string, unknown>): { tab?: ArtistTab } => {
    const tab = search.tab
    return {
      tab: ARTIST_TABS.includes(tab as ArtistTab)
        ? (tab as ArtistTab)
        : undefined,
    }
  },
  component: ArtistPage,
})

function ArtistPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<ArtistProfile | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [albums, setAlbums] = useState<ArtistAlbum[]>([])
  const [mvs, setMvs] = useState<Mv[]>([])
  const [similar, setSimilar] = useState<ArtistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const { tab: tabParam } = Route.useSearch()
  const tab = tabParam ?? 'songs'
  const [albumsLoadingMore, setAlbumsLoadingMore] = useState(false)
  const [albumsDone, setAlbumsDone] = useState(false)
  const isLogin = useUserStore((state) => state.isLogin)
  const localSubscribedArtists = useLocalLibraryStore(
    (state) => state.subscribedArtists,
  )
  const toggleLocalArtist = useLocalLibraryStore(
    (state) => state.toggleSubscribedArtist,
  )
  const cacheLocalArtist = useLocalLibraryStore(
    (state) => state.cacheSubscribedArtist,
  )
  const [followed, setFollowed] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  // How many albums were loaded on the previous visit; the route holds no
  // component state, so the list must be rebuilt before scroll can restore.
  const albumsRestoreRef = useRef(false)
  useDocumentTitle(profile?.name ?? i18n._(msg`歌手`))

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setSongs([])
    setAlbums([])
    setMvs([])
    setSimilar([])
    setAlbumsLoadingMore(false)
    setAlbumsDone(false)
    albumsRestoreRef.current = false

    Promise.allSettled([
      fetchArtistProfile(id, controller.signal),
      fetchArtistTopSongs(id, controller.signal),
      // Album latency grows with the page size upstream, so load a small first
      // page and fetch the rest only when the user asks for it.
      fetchArtistAlbums(id, 12, 0, controller.signal),
      fetchArtistMvs(id, 12, 0, controller.signal),
      fetchSimilarArtists(id, controller.signal),
    ])
      .then((results) => {
        if (cancelled) return
        const [artistResult, songsResult, albumsResult, mvsResult, similarResult] = results
        if (artistResult.status === 'fulfilled') setProfile(artistResult.value)
        if (songsResult.status === 'fulfilled') setSongs(songsResult.value)
        if (albumsResult.status === 'fulfilled') {
          setAlbums(albumsResult.value)
          if (albumsResult.value.length < 12) setAlbumsDone(true)
          try {
            // Never shrink the record: a later visit that loaded more pages
            // must still restore that longer list (the writer below bumps it).
            const stored = Number(
              sessionStorage.getItem(`artist-albums:${id}`) ?? 0,
            )
            if (
              !Number.isFinite(stored) ||
              albumsResult.value.length > stored
            ) {
              sessionStorage.setItem(
                `artist-albums:${id}`,
                String(albumsResult.value.length),
              )
            }
          } catch {
            // storage may be unavailable
          }
        }
        if (mvsResult.status === 'fulfilled') setMvs(mvsResult.value)
        if (similarResult.status === 'fulfilled') setSimilar(similarResult.value)
        if (results.some((result) => result.status === 'rejected')) {
          toast.error(i18n._(msg`部分歌手信息加载失败`))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  // Rebuild the album list to the length a previous visit had. Without this the
  // detail-page round trip would drop back to the first page, and AppShell's
  // scroll restore would clamp to a much shorter list.
  useEffect(() => {
    if (loading || albumsRestoreRef.current) return
    albumsRestoreRef.current = true
    let target = 0
    try {
      target = Number(sessionStorage.getItem(`artist-albums:${id}`) ?? 0)
    } catch {
      return
    }
    if (!Number.isFinite(target) || target <= albums.length || albumsDone) {
      return
    }
    let cancelled = false
    /**
     * Silent backfill: the user did not ask for more pages, so this must never
     * light up the "load more" spinner (that button spinning forever was the
     * bug report). Two 50-item requests cover the usual offsets, and each one
     * gets its own timeout so a slow upstream cannot hang the loop.
     */
    const restore = async () => {
      let loaded = albums.length
      let pages = 0
      while (!cancelled && loaded < target && pages < 2) {
        let next: Awaited<ReturnType<typeof fetchArtistAlbums>> = []
        try {
          next = await fetchArtistAlbums(id, 50, loaded, AbortSignal.timeout(8000))
        } catch {
          break
        }
        if (cancelled) return
        if (!next.length) {
          setAlbumsDone(true)
          break
        }
        setAlbums((current) => {
          const seen = new Set(current.map((album) => album.id))
          return [...current, ...next.filter((album) => !seen.has(album.id))]
        })
        loaded += next.length
        pages += 1
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
    // `albums` / `albumsDone` are read once, when the first page has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, id])

  // Guests follow into the local library, the signed-in account into NetEase;
  // re-derive whenever either side changes (login, id, local edits). Kept
  // above the early returns so the hook order never changes.
  useEffect(() => {
    if (!profile) return
    const localRecord = localSubscribedArtists.find(
      (item) => Number(item.id) === Number(profile.id),
    )
    // Follows saved before the cover/avatar fallback have no image; opening the
    // artist page backfills it once.
    if (!isLogin && localRecord && !localRecord.picUrl) {
      void cacheLocalArtist({
        ...profile,
        picUrl: profile.picUrl || profile.cover || profile.avatar || '',
      })
    }
    setFollowed(isLogin ? Boolean(profile.followed) : Boolean(localRecord))
  }, [profile, isLogin, localSubscribedArtists, cacheLocalArtist])

  if (loading) {
    return (
      <div className="page">
        <div className="flex flex-col items-center gap-6 rounded-[22px] border border-black/8 bg-white/55 p-6 md:flex-row md:items-end">
          <Skeleton className="h-[168px] w-[168px] rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="h-8 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
            <Skeleton className="h-3 w-4/5 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-6 h-[420px] w-full rounded-[18px]" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page">
        <EmptyState title={i18n._(msg`歌手不存在或无法访问`)} />
      </div>
    )
  }

  const aliasLine = [...(profile.transNames ?? []), ...(profile.alias ?? [])]
    .filter(Boolean)
    .join(' / ')
  const playlistId = `artist-${id}`

  const handleToggleFollow = async () => {
    if (!profile || followBusy) return
    setFollowBusy(true)
    const next = !followed
    try {
      if (isLogin) {
        if (!(await subscribeArtist(profile.id, next))) {
          throw new Error('artist/sub failed')
        }
        setProfile((current) =>
          current ? { ...current, followed: next } : current,
        )
        setFollowed(next)
        // Keep the sidebar's "关注的歌手" in step without a reload.
        void useUserStore.getState().loadCollectedArtists()
      } else {
        // `/artist/detail` leaves picUrl empty, so hand the sidebar the same
        // cover the header uses.
        const result = await toggleLocalArtist({
          ...profile,
          picUrl: profile.picUrl || profile.cover || profile.avatar || '',
        })
        if (result === null) return
        setFollowed(result)
      }
      toast.success(next ? i18n._(msg`已关注`) : i18n._(msg`已取消关注`))
    } catch {
      toast.error(i18n._(msg`操作失败`))
    } finally {
      setFollowBusy(false)
    }
  }

  const handleLoadMoreAlbums = async () => {
    if (albumsLoadingMore || albumsDone) return
    setAlbumsLoadingMore(true)
    try {
      // Bound the wait: a stalled upstream used to leave the button spinning
      // until the shared 15s HTTP timeout fired.
      const next = await fetchArtistAlbums(
        id,
        12,
        albums.length,
        AbortSignal.timeout(8000),
      )
      if (!next.length) {
        setAlbumsDone(true)
        return
      }
      setAlbums((current) => {
        const seen = new Set(current.map((album) => album.id))
        return [...current, ...next.filter((album) => !seen.has(album.id))]
      })
      try {
        sessionStorage.setItem(
          `artist-albums:${id}`,
          String(albums.length + next.length),
        )
      } catch {
        // storage may be unavailable
      }
      if (next.length < 12) setAlbumsDone(true)
    } catch {
      toast.error(i18n._(msg`专辑加载失败`))
    } finally {
      setAlbumsLoadingMore(false)
    }
  }

  return (
    <div className="page">
      <button
        type="button"
        onClick={() => {
          // Similar-artist links can land here without app history; fall back
          // to discover instead of leaving the user stuck.
          if (window.history.length > 1) window.history.back()
          else void navigate({ to: '/' })
        }}
        aria-label={i18n._(msg`返回`)}
        title={i18n._(msg`返回`)}
        className="pressable mb-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-1 dark:hover:bg-white/10"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="rounded-[22px] border border-black/8 bg-white/55 p-6 backdrop-blur-xl">
        {/* Keep the avatar pinned to the top. Centring it against the text
            block made the portrait jump down whenever the biography expanded. */}
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-8">
          <ImageWithFallback
            src={profile.cover ?? profile.picUrl}
            alt={profile.name}
            rounded="rounded-full"
            className="artwork-shadow h-[184px] w-[184px] shrink-0"
            resize="400y400"
            priority
          />
          <div className="min-w-0 flex-1 text-center md:text-left">
            <span className="eyebrow">
              <Trans>歌手</Trans>
            </span>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <h1 className="headline-lg">{profile.name}</h1>
              <Button
                variant={followed ? 'secondary' : 'primary'}
                size="sm"
                className="rounded-full px-3.5 text-[12px]"
                disabled={followBusy}
                aria-pressed={followed}
                onClick={() => void handleToggleFollow()}
              >
                {followed ? (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                )}
                {followed ? <Trans>已关注</Trans> : <Trans>关注歌手</Trans>}
              </Button>
            </div>
            {aliasLine ? (
              <p className="mt-1 text-[12px] text-ink-3">{aliasLine}</p>
            ) : null}

            {profile.identities?.length ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 md:justify-start">
                {profile.identities.map((identity) => (
                  <span
                    key={identity}
                    className="rounded-full border border-black/8 bg-white/60 px-2 py-0.5 text-[11px] text-ink-3"
                  >
                    {identity}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-ink-3 md:justify-start">
              <span className="flex items-center gap-1.5">
                <Music2 className="h-3.5 w-3.5" />
                <Trans>{formatNumber(profile.musicSize)} 首单曲</Trans>
              </span>
              <span className="flex items-center gap-1.5">
                <Disc3 className="h-3.5 w-3.5" />
                <Trans>{formatNumber(profile.albumSize)} 张专辑</Trans>
              </span>
              <span className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" />
                <Trans>{formatNumber(profile.mvSize)} 个 MV</Trans>
              </span>
              {profile.rank?.rank ? (
                <span className="rounded-full bg-accent/8 px-2 py-0.5 text-[11px] text-accent">
                  <Trans>歌手榜 No.{profile.rank.rank}</Trans>
                </span>
              ) : null}
            </div>

            {profile.briefDesc ? (
              <div className="mt-4 max-w-[860px]">
                <p className="eyebrow text-left">
                  <Trans>歌手简介</Trans>
                </p>
                <ExpandableDescription
                  text={profile.briefDesc}
                  className="mt-1.5"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        // Kept in the URL (replace, no history spam) so returning from an album
        // lands back on the same tab.
        onValueChange={(value) =>
          void navigate({
            to: '/artist/$id',
            params: { id },
            search: { tab: value as ArtistTab },
            replace: true,
          })
        }
        className="mt-6"
      >
        <div className="flex items-center justify-between gap-3 border-b border-black/8 pb-2">
          <TabsList>
            <TabsTrigger value="songs">
              <Trans>热门作品</Trans>
            </TabsTrigger>
            <TabsTrigger value="albums">
              <Trans>专辑</Trans>
            </TabsTrigger>
            <TabsTrigger value="mvs">MV</TabsTrigger>
          </TabsList>
          {tab === 'songs' && songs.length ? (
            <PlayAllButton
            songs={songs}
            playlistId={playlistId}
            label={i18n._(msg`播放热门歌曲`)}
          />
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共 {songs.length} 首热门单曲</Trans>
          </div>
          <SongTable
            songs={songs}
            playlistId={playlistId}
            // Every row is this artist: no 歌手 column, only featured artists.
            pageArtistId={profile.id}
            emptyText={i18n._(msg`暂无热门单曲`)}
          />
        </TabsContent>

        <TabsContent value="albums" className="mt-3">
          {albums.length ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {albums.map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: '/albums/$id',
                        params: { id: String(album.id) },
                      })
                    }
                    className="apple-card group p-2.5 text-left"
                  >
                    <div className="album-card-cover relative rounded-[10px]">
                      <ImageWithFallback
                        src={album.picUrl}
                        alt={album.name}
                        rounded="rounded-[10px]"
                        className="aspect-square w-full"
                        resize="240y240"
                      />
                    </div>
                    <span className="mt-2 line-clamp-2 block text-[12px] leading-[1.4] text-ink-2 transition-colors group-hover:text-accent">
                      {album.name}
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-4">
                      {formatDate(album.publishTime).slice(0, 4)}
                      {album.size ? (
                        <Trans> · {album.size} 首</Trans>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
              {!albumsDone && albums.length < (profile.albumSize ?? Infinity) ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full px-4"
                    loading={albumsLoadingMore}
                    onClick={() => void handleLoadMoreAlbums()}
                  >
                    <Trans>加载更多专辑</Trans>
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title={i18n._(msg`暂无专辑`)} />
          )}
        </TabsContent>

        <TabsContent value="mvs" className="mt-3">
          {mvs.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {mvs.map((mv) => (
                <MvCard key={mv.id} mv={mv} />
              ))}
            </div>
          ) : (
            <EmptyState title={i18n._(msg`暂无相关 MV`)} />
          )}
        </TabsContent>
      </Tabs>

      {similar.length ? (
        <section className="mt-10">
          <p className="section-title">
            <Trans>相似歌手</Trans>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {similar.slice(0, 8).map((artist) => (
              <button
                key={artist.id}
                type="button"
                onClick={() =>
                  void navigate({ to: '/artist/$id', params: { id: String(artist.id) } })
                }
                className="group flex items-center gap-3 rounded-[14px] border border-black/8 bg-white/55 p-3 text-left transition-colors hover:bg-white/80"
              >
                <ImageWithFallback
                  src={artist.picUrl}
                  alt={artist.name}
                  rounded="rounded-full"
                  className="avatar-ring h-14 w-14 shrink-0"
                  resize="128y128"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink-2 group-hover:text-accent">
                    {artist.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-4">
                    {/* `a ?? b ?? c ? x : y` parsed as `(a ?? b ?? c) ? x : y`:
                        an alias showed "0 粉丝" and was never itself shown. */}
                    {artist.alias?.[0] ?? artist.transNames?.[0] ?? (
                      artist.fansCount ? (
                        <Trans>{formatNumber(artist.fansCount)} 粉丝</Trans>
                      ) : (
                        <Trans>相似歌手</Trans>
                      )
                    )}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
