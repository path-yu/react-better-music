import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Disc3, ListMusic, Search, Users } from 'lucide-react'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { SearchBox } from '../components/layout/SearchBox'
import { EmptyState } from '../components/common/EmptyState'
import { Pager } from '../components/common/Pager'
import { AlbumCard } from '../components/cards/AlbumCard'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { UserCard } from '../components/user/UserCard'
import { VideoCard } from '../components/video/VideoCard'
import { deepSearchSongs, searchAll, type DeepSearchHit } from '../api'
import { formatNumber } from '../lib/format'
import {
  cacheSearchResult,
  getCachedSearchResult,
} from '../lib/searchCache'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import { useSearchStore } from '../store/search'
import type {
  Album,
  ArtistSummary,
  Playlist,
  SearchResult,
  Song,
  UserSummary,
  VideoItem,
} from '../types'

const SEARCH_TABS = ['songs', 'playlists', 'albums', 'artists', 'users', 'mvs', 'videos'] as const
type SearchTab = (typeof SEARCH_TABS)[number]

function normalizeTab(value: unknown): SearchTab {
  return SEARCH_TABS.includes(value as SearchTab) ? (value as SearchTab) : 'songs'
}

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>) => {
    const page = Math.floor(Number(search.page))
    return {
      keyword: typeof search.keyword === 'string' ? search.keyword : '',
      // Keeping the tab in the URL makes browser Back restore it instead of
      // falling back to 单曲 after visiting a video/MV page.
      tab: normalizeTab(search.tab),
      // Same for the page: Back from a song/album returns to page 3, not 1.
      // Omitted for page 1 so existing links and navigations stay valid.
      ...(page > 1 ? { page } : {}),
    }
  },
  component: SearchPage,
})

const SONG_PAGE_SIZE = 30
const PLAYLIST_PAGE_SIZE = 20
const ALBUM_PAGE_SIZE = 20
const ARTIST_PAGE_SIZE = 20
const USER_PAGE_SIZE = 20
const VIDEO_PAGE_SIZE = 20

function normalizeQuery(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_—·()（）[\]【】「」'"“”,，.。!！?？/]/g, '')
}

/** A live/remix/instrumental upload is not the original. */
const DECORATED_TITLE =
  /(live|remix|dj|伴奏|翻唱|cover|纯音乐|instrumental|bootleg|type\s*beat|\bbeat\b|v\d|加速|降速|片段|剪辑|铃声|女声版|男声版|\d(?:\.\d)?x)/i

/**
 * True when an undecorated hit really is the requested song.
 *
 * Matching every word anywhere in "title + artists" was too loose: with
 * "一路向北 周杰伦", a row titled `周杰伦"一路向北" Emo Rap Type beat` by
 * WEICHENG-BEAT satisfied it, so the fallback never ran. One of the words is
 * an artist, so it must appear in the credits, not just in the title.
 */
function hasDirectMatch(songs: Song[], keyword: string) {
  const tokens = keyword
    .trim()
    .split(/\s+/)
    .map(normalizeQuery)
    .filter(Boolean)
  if (!tokens.length) return true
  if (tokens.length === 1) {
    return songs.some(
      (song) =>
        !DECORATED_TITLE.test(song.name) &&
        normalizeQuery(song.name).includes(tokens[0]),
    )
  }
  const covered = (titleTokens: string[], artistToken: string, song: Song) => {
    if (DECORATED_TITLE.test(song.name)) return false
    const name = normalizeQuery(song.name)
    const artists = normalizeQuery(
      song.ar.map((artist) => artist.name).join(' '),
    )
    return (
      titleTokens.every((token) => name.includes(token)) &&
      artists.includes(artistToken)
    )
  }
  return songs.some((song) => {
    // "song artist" and "artist song" are both common ways to type a query.
    return (
      covered(tokens.slice(0, -1), tokens[tokens.length - 1], song) ||
      covered(tokens.slice(1), tokens[0], song)
    )
  })
}

function SearchPage() {
  const { i18n } = useLingui()
  const { keyword, tab, page = 1 } = Route.useSearch()
  const navigate = useNavigate()
  useDocumentTitle(
    keyword.trim()
      ? i18n._(msg`搜索「${keyword.trim()}」`)
      : i18n._(msg`搜索`),
  )
  // The page lives in the URL. A new keyword or tab navigates without it, so
  // the first request is already for page 1 (no extra request with the old
  // page), and Back restores the page the user was on.
  const setPage = useCallback(
    (value: number) => {
      void navigate({
        to: '/search',
        search: { keyword, tab, ...(value > 1 ? { page: value } : {}) },
      })
    },
    [keyword, navigate, tab],
  )
  const [songs, setSongs] = useState<Song[]>([])
  const [songTotal, setSongTotal] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistTotal, setPlaylistTotal] = useState(0)
  const [albums, setAlbums] = useState<Album[]>([])
  const [albumTotal, setAlbumTotal] = useState(0)
  const [artists, setArtists] = useState<ArtistSummary[]>([])
  const [artistTotal, setArtistTotal] = useState(0)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [mvs, setMvs] = useState<VideoItem[]>([])
  const [mvTotal, setMvTotal] = useState(0)
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [videoTotal, setVideoTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  // A failed request must not look like an empty result set.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Songs recovered from album track lists / the web lookup when the song
  // index has nothing. The toggle lives next to the search box and controls
  // whether the fallback runs at all.
  const deepEnabled = useSearchStore((state) => state.deepSearch)
  const [deepSongs, setDeepSongs] = useState<DeepSearchHit[]>([])
  const [deepLoading, setDeepLoading] = useState(false)
  const deepKeywordRef = useRef('')
  const songsRef = useRef<Song[]>([])

  useEffect(() => {
    songsRef.current = songs
  }, [songs])
  const setLastSearch = useSearchStore((state) => state.setSearch)
  /** Bumped by the search box when the same query is submitted again. */
  const refreshToken = useSearchStore((state) => state.refreshToken)
  const handleKeywordChange = useCallback(
    (value: string) => setLastSearch(value, tab),
    [setLastSearch, tab],
  )

  useEffect(() => {
    setLastSearch(keyword, tab)
  }, [keyword, tab, setLastSearch])

  useEffect(() => {
    setSongs([])
    setPlaylists([])
    setAlbums([])
    setArtists([])
    setUsers([])
    setMvs([])
    setVideos([])
    setSongTotal(0)
    setPlaylistTotal(0)
    setAlbumTotal(0)
    setArtistTotal(0)
    setUserTotal(0)
    setMvTotal(0)
    setVideoTotal(0)
    setFailed(false)
    setDeepSongs([])
    setDeepLoading(false)
    deepKeywordRef.current = ''
  }, [keyword])

  const applyResult = useCallback(
    (result: SearchResult) => {
      if (tab === 'songs') {
        setSongs(result.songs ?? [])
        setSongTotal(result.songCount ?? 0)
      } else if (tab === 'artists') {
        setArtists(result.artists ?? [])
        setArtistTotal(result.artistCount ?? 0)
      } else if (tab === 'albums') {
        setAlbums(result.albums ?? [])
        setAlbumTotal(result.albumCount ?? 0)
      } else if (tab === 'users') {
        setUsers(result.users ?? [])
        setUserTotal(result.userCount ?? 0)
      } else if (tab === 'mvs') {
        setMvs(result.mvs ?? [])
        setMvTotal(result.mvCount ?? 0)
      } else if (tab === 'videos') {
        setVideos(result.videos ?? [])
        setVideoTotal(result.videoCount ?? 0)
      } else {
        setPlaylists(result.playlists ?? [])
        setPlaylistTotal(result.playlistCount ?? 0)
      }
    },
    [tab],
  )

  useEffect(() => {
    if (!keyword.trim()) return
    // The refresh token is part of the key: pressing Enter again must hit the
    // API instead of replaying the cached payload.
    const cacheKey = `${keyword}|${tab}|${page}|${refreshToken}`
    const cached = getCachedSearchResult(cacheKey)
    if (cached) {
      setFailed(false)
      setLoading(false)
      applyResult(cached)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    const pageSize =
      tab === 'songs'
        ? SONG_PAGE_SIZE
        : tab === 'artists'
          ? ARTIST_PAGE_SIZE
          : tab === 'users'
            ? USER_PAGE_SIZE
            : tab === 'albums'
              ? ALBUM_PAGE_SIZE
              : tab === 'mvs' || tab === 'videos'
                ? VIDEO_PAGE_SIZE
                : PLAYLIST_PAGE_SIZE
    const type: '1' | '10' | '100' | '1000' | '1002' | '1004' | '1014' =
      tab === 'songs'
        ? '1'
        : tab === 'artists'
          ? '100'
          : tab === 'users'
            ? '1002'
            : tab === 'albums'
              ? '10'
              : tab === 'mvs'
                ? '1004'
                : tab === 'videos'
                  ? '1014'
                  : '1000'
    searchAll(
      {
        keywords: keyword,
        type,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        cacheSearchResult(cacheKey, result)
        applyResult(result)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFailed(true)
        toast.error(i18n._(msg`搜索失败`))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [keyword, tab, page, attempt, refreshToken, applyResult])

  /**
   * Song search skips unlicensed tracks entirely. When no hit covers the
   * query, scan the albums the same query returns: their track lists still
   * contain the grey originals.
   */
  // A resubmitted query must be allowed to run the fallback again, even if it
  // already ran (and finished) for the same keyword.
  useEffect(() => {
    deepKeywordRef.current = ''
  }, [refreshToken])

  useEffect(() => {
    if (!deepEnabled) {
      setDeepSongs([])
      setDeepLoading(false)
      deepKeywordRef.current = ''
      return
    }
    if (tab !== 'songs' || page !== 1) {
      // Leaving the page must not block a later run for the same keyword.
      deepKeywordRef.current = ''
      return
    }
    const query = keyword.trim()
    if (!query || loading || failed) return
    if (hasDirectMatch(songsRef.current, query)) {
      setDeepSongs([])
      deepKeywordRef.current = ''
      return
    }
    if (deepKeywordRef.current === query) return
    deepKeywordRef.current = query

    const controller = new AbortController()
    const startedWith = query
    setDeepLoading(true)
    setDeepSongs([])
    deepSearchSongs(query, controller.signal)
      .then((hits) => {
        if (controller.signal.aborted) return
        const seen = new Set(songsRef.current.map((song) => song.id))
        setDeepSongs(hits.filter((hit) => !seen.has(hit.song.id)))
      })
      .catch(() => undefined)
      .finally(() => {
        // Even after an abort the spinner must stop; a new run for another
        // keyword will set it again.
        if (deepKeywordRef.current === startedWith) setDeepLoading(false)
      })
    return () => controller.abort()
  }, [tab, page, keyword, loading, failed, deepEnabled, refreshToken])

  const retry = () => setAttempt((value) => value + 1)

  const changeTab = (value: string) => {
    void navigate({
      to: '/search',
      search: { keyword, tab: normalizeTab(value) },
      replace: true,
    })
  }

  const openVideoItem = (item: VideoItem) => {
    if (item.kind === 'mv') {
      void navigate({ to: '/mv/$id', params: { id: String(item.id) } })
      return
    }
    void navigate({
      to: '/video/$id',
      params: { id: String(item.id) },
      search: {
        kind: item.kind,
        title: item.title,
        cover: item.cover ?? '',
        artist: item.artist ?? '',
        duration: item.duration ?? 0,
      },
    })
  }

  const pageSize =
    tab === 'songs'
      ? SONG_PAGE_SIZE
      : tab === 'artists'
        ? ARTIST_PAGE_SIZE
        : tab === 'users'
          ? USER_PAGE_SIZE
          : tab === 'albums'
            ? ALBUM_PAGE_SIZE
            : tab === 'mvs' || tab === 'videos'
              ? VIDEO_PAGE_SIZE
              : PLAYLIST_PAGE_SIZE
  const total =
    tab === 'songs'
      ? songTotal
      : tab === 'artists'
        ? artistTotal
        : tab === 'users'
          ? userTotal
          : tab === 'albums'
            ? albumTotal
            : tab === 'mvs'
              ? mvTotal
              : tab === 'videos'
                ? videoTotal
                : playlistTotal
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])

  const hasKeyword = Boolean(keyword.trim())

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-[560px]">
        <SearchBox
          initialKeyword={keyword}
          autoFocus={!hasKeyword}
          className="max-w-[560px]"
          onKeywordChange={handleKeywordChange}
        />
        {!hasKeyword ? (
          <div className="pt-10">
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title={i18n._(msg`搜索音乐、歌单、专辑、歌手、用户、MV 或视频`)}
              description={i18n._(msg`输入关键词后按回车开始搜索`)}
            />
          </div>
        ) : null}
      </div>

      {hasKeyword ? (
        <>
          <div>
        <p className="eyebrow">
          <Trans>搜索结果</Trans>
        </p>
        <h1 className="headline-lg mt-1.5 line-clamp-1">“{keyword}”</h1>
      </div>

      <Tabs value={tab} onValueChange={changeTab} className="mt-5">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--app-border)] sticky-bar pb-2 pt-2 page-bleed">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="songs">
              <Trans>单曲</Trans>
            </TabsTrigger>
            <TabsTrigger value="playlists">
              <Trans>歌单</Trans>
            </TabsTrigger>
            <TabsTrigger value="albums">
              <Trans>专辑</Trans>
            </TabsTrigger>
            <TabsTrigger value="artists">
              <Trans>歌手</Trans>
            </TabsTrigger>
            <TabsTrigger value="users">
              <Trans>用户</Trans>
            </TabsTrigger>
            <TabsTrigger value="mvs">MV</TabsTrigger>
            <TabsTrigger value="videos">
              <Trans>视频</Trans>
            </TabsTrigger>
          </TabsList>
          {tab === 'songs' && songs.length ? (
            <PlayAllButton
              songs={songs}
              playlistId={`search-${keyword}-${page}`}
              label={i18n._(msg`播放本页`)}
            />
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`搜索失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-ink-4">
                <span>
                  <Trans>共找到 {songTotal} 首单曲</Trans>
                </span>
              </div>
              {deepEnabled && page === 1 && deepLoading ? (
                <p className="mb-3 text-[11px] text-ink-4">
                  <Trans>正在查找原曲…</Trans>
                </p>
              ) : null}

              {/* Above the main table on purpose: with 30 rows per page the
                  fallback results would otherwise sit far below the fold. */}
              {deepEnabled && page === 1 && !deepLoading && deepSongs.length ? (
                <section className="mb-6">
                  <div className="mb-2 flex items-baseline gap-2">
                    <h2 className="section-title">
                      <Trans>来自相关专辑</Trans>
                    </h2>
                    <span className="text-[11px] tabular-nums text-ink-4">
                      {deepSongs.length}
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] leading-relaxed text-ink-4">
                    <Trans>这些歌曲没有出现在单曲搜索结果里（可能已下架），仍可通过换源播放</Trans>
                  </p>
                  <SongTable
                    songs={deepSongs.map((hit) => hit.song)}
                    playlistId={`search-deep-${keyword}`}
                    emptyText={i18n._(msg`没有找到相关单曲`)}
                  />
                </section>
              ) : null}

              <SongTable
                songs={songs}
                playlistId={`search-${keyword}-${page}`}
                loading={loading}
                emptyText={i18n._(msg`没有找到相关单曲`)}
              />
              <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
            </>
          )}
        </TabsContent>

        <TabsContent value="playlists" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {playlistTotal} 个歌单</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`歌单加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-[68px] w-full rounded-[14px]" />
              ))}
            </div>
          ) : playlists.length ? (
            <div className="space-y-1">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: '/songlists/$id',
                      params: { id: String(playlist.id) },
                    })
                  }
                  className="group flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-black/4"
                >
                  <ImageWithFallback
                    src={playlist.coverImgUrl}
                    alt={playlist.name}
                    rounded="rounded-[10px]"
                    className="h-14 w-14 shrink-0"
                    resize="128y128"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] text-ink-2 group-hover:text-accent">
                      {playlist.name}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-4">
                      <span>
                        <Trans>{playlist.trackCount} 首</Trans>
                      </span>
                      <span>by {playlist.creator?.nickname}</span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-4">
                    <ListMusic className="h-3 w-3" />
                    {formatNumber(playlist.playCount)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={i18n._(msg`没有找到相关歌单`)} />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="albums" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {albumTotal} 张专辑</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`专辑加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-square w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : albums.length ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {albums.map((album, index) => (
                <AlbumCard key={album.id} album={album} priority={index < 5} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Disc3 className="h-6 w-6" />}
              title={i18n._(msg`没有找到相关专辑`)}
            />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="artists" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {artistTotal} 位歌手</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`歌手加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-[84px] w-full rounded-[14px]" />
              ))}
            </div>
          ) : artists.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {artists.map((artist) => (
                <button
                  key={artist.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: '/artist/$id',
                      params: { id: String(artist.id) },
                    })
                  }
                  className="group flex items-center gap-3 rounded-[14px] border border-black/8 bg-white/55 p-3 text-left transition-colors hover:bg-white/80"
                >
                  {/* Hairline ring: NetEase's default avatar is plain white
                      and vanished into the light card. */}
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
                    {/* Without an alias this line used to repeat the album
                        count shown on the next line. */}
                    {artist.alias?.[0] ?? artist.transNames?.[0] ? (
                      <p className="mt-0.5 truncate text-[11px] text-ink-4">
                        {artist.alias?.[0] ?? artist.transNames?.[0]}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-ink-4">
                      <Trans>
                        {artist.albumSize ?? 0} 张专辑 · {artist.mvSize ?? 0} 个 MV
                      </Trans>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={i18n._(msg`没有找到相关歌手`)} />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="users" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {userTotal} 位用户</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`用户加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-[86px] w-full rounded-[14px]" />
              ))}
            </div>
          ) : users.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {users.map((user) => (
                <UserCard key={user.userId} user={user} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={i18n._(msg`没有找到相关用户`)}
            />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>

        <TabsContent value="mvs" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {mvTotal} 个 MV</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`MV 加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-video w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : mvs.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {mvs.map((item, index) => (
                <VideoCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  priority={index < 4}
                  onClick={() => openVideoItem(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={i18n._(msg`没有找到相关 MV`)} />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="videos" className="mt-3">
          <div className="mb-2 text-[11px] text-ink-4">
            <Trans>共找到 {videoTotal} 个视频</Trans>
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`视频加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-video w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : videos.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {videos.map((item, index) => (
                <VideoCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  priority={index < 4}
                  onClick={() => openVideoItem(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={i18n._(msg`没有找到相关视频`)} />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>

      </Tabs>
        </>
      ) : null}
    </div>
  )
}
