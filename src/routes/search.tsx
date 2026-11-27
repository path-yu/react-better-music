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
import { useSearchStore, type SearchMode } from '../store/search'
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
/**
 * "歌名 歌手" queries need a wider window: NetEase may bury the exact upload
 * on page 2, and relevance sorting can only reorder rows that were fetched.
 * Fetch up to 100 rows so the match is inside the sortable window.
 */
const SONG_ARTIST_PAGE_SIZE = 100
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

/**
 * "胭脂妆（Cover 树屋女孩）" has no space before `Cover`, so normalising the
 * query turns the title token into "胭脂妆cover". The marker describes the
 * requested recording and must be compared separately from the song title.
 */
const COVER_MARKER = /(?:cover|翻唱)$/i

function queryTokens(keyword: string) {
  return keyword
    .trim()
    .split(/\s+/)
    .map(normalizeQuery)
    .filter(Boolean)
}

function songPageSize(keyword: string) {
  // "（Cover …）封" has no space before the artist, but is still a two-part query.
  const hasTrailingArtist = /[）)]\s*\S/.test(keyword.trim())
  return queryTokens(keyword).length > 1 || hasTrailingArtist
    ? SONG_ARTIST_PAGE_SIZE
    : SONG_PAGE_SIZE
}

function wantsCover(tokens: string[]) {
  return tokens.some((token) => /(?:cover|翻唱)/.test(token))
}

interface QueryInterpretation {
  titleTokens: string[]
  artistTokens: string[]
}

/**
 * Split "title（Cover original artist） trailing artist" into title and credit
 * parts. Plain "song artist" / "artist song" input gets both orders tried.
 */
function queryInterpretations(keyword: string): QueryInterpretation[] {
  const raw = keyword.trim()
  if (!raw) return []
  const titleTokensOf = (value: string) =>
    value
      .split(/\s+/)
      .map(normalizeQuery)
      .map((token) => token.replace(COVER_MARKER, ''))
      .filter(Boolean)
  const artistTokensOf = (value: string) =>
    value.split(/\s+/).map(normalizeQuery).filter(Boolean)

  const parenthetical = raw.match(/^(.*?)[（(]([^）)]*)[）)]\s*(.*)$/)
  if (parenthetical) {
    return [
      {
        titleTokens: titleTokensOf(`${parenthetical[1]} ${parenthetical[2]}`),
        artistTokens: artistTokensOf(parenthetical[3] ?? ''),
      },
    ]
  }

  const words = raw.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return [
      {
        titleTokens: titleTokensOf(words.slice(0, -1).join(' ')),
        artistTokens: artistTokensOf(words[words.length - 1]),
      },
      {
        titleTokens: titleTokensOf(words.slice(1).join(' ')),
        artistTokens: artistTokensOf(words[0]),
      },
    ]
  }
  return [{ titleTokens: titleTokensOf(raw), artistTokens: [] }]
}

/** Higher scores are pinned above NetEase's default ordering. */
function scoreInterpretation(
  song: Song,
  interpretation: QueryInterpretation,
) {
  const { titleTokens, artistTokens } = interpretation
  if (!titleTokens.length && !artistTokens.length) return 0
  const name = normalizeQuery(song.name)
  const artists = normalizeQuery(
    song.ar.map((artist) => artist.name).join(' '),
  )
  const titleHit =
    titleTokens.length > 0 && titleTokens.every((token) => name.includes(token))
  const artistHit =
    artistTokens.length > 0 &&
    artistTokens.every((token) => artists.includes(token))

  if (!titleTokens.length) return artistHit ? 1 : 0
  if (!titleHit) return 0
  if (!artistTokens.length) return 3
  return artistHit ? 4 : 3
}

function searchMatchScore(song: Song, keyword: string) {
  let best = 0
  for (const interpretation of queryInterpretations(keyword)) {
    best = Math.max(best, scoreInterpretation(song, interpretation))
  }
  return best
}

function sortSongsByRelevance(songs: Song[], keyword: string) {
  if (!queryInterpretations(keyword).length) return songs
  return songs
    .map((song, index) => ({ song, index, score: searchMatchScore(song, keyword) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.song)
}

/**
 * True when a hit for the requested recording is already in the results.
 *
 * Matching every word anywhere in "title + artists" was too loose: with
 * "一路向北 周杰伦", a row titled `周杰伦"一路向北" Emo Rap Type beat` by
 * WEICHENG-BEAT satisfied it, so the fallback never ran. One of the words is
 * an artist, so it must appear in the credits, not just in the title.
 */
function hasDirectMatch(
  songs: Song[],
  keyword: string,
  mode: SearchMode,
) {
  // Album mode always runs the fallback: the goal is to read the release's
  // track list, and a cover that happens to share the title is not a hit.
  if (mode === 'album') return false
  const tokens = queryTokens(keyword)
  if (!tokens.length) return true
  // "Cover" asks for a different recording, so an undecorated original must
  // not suppress the fallback; only an actual cover counts as a direct hit.
  if (wantsCover(tokens)) {
    return songs.some((song) => {
      if (!/(?:cover|翻唱)/i.test(song.name)) return false
      return queryInterpretations(keyword).some((interpretation) => {
        const name = normalizeQuery(song.name)
        const artists = normalizeQuery(
          song.ar.map((artist) => artist.name).join(' '),
        )
        return (
          interpretation.titleTokens.every((token) => name.includes(token)) &&
          interpretation.artistTokens.every((token) => artists.includes(token))
        )
      })
    })
  }
  // "New Jeans" (with a space) is still one artist name. An artist query must
  // not count remixes/covers as a complete result set: the fallback walks the
  // artist's albums to surface the delisted originals.
  if (tokens.length === 1) {
    const token = tokens[0]
    // A word that appears in a *title* is a song search: covers dominate once
    // the original is delisted, so let the fallback look for it. Only a bare
    // artist name ("周杰伦") means the list already is that catalogue — and
    // even then a same-named cover account ("一路向北") must not count, which
    // is why the title check runs first.
    const titleHit = songs.some((song) =>
      normalizeQuery(song.name).includes(token),
    )
    if (titleHit) return false
    return songs.some((song) =>
      song.ar.some((artist) => normalizeQuery(artist.name) === token),
    )
  }

  // Multi-word queries ("歌名 歌手" / "歌名 专辑"): the song index routinely
  // answers with a cover credited to an account named after the drama or the
  // album ("爱的回归线" by 爱情公寓), so a row that technically matches the
  // words is not proof the original exists. Always let the fallback decide.
  return false
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
  const searchMode = useSearchStore((state) => state.searchMode)
  const [deepSongs, setDeepSongs] = useState<DeepSearchHit[]>([])
  const [deepLoading, setDeepLoading] = useState(false)
  const deepKeywordRef = useRef('')
  const songsRef = useRef<Song[]>([])
  /** Keyword whose song list has actually been applied to state. */
  const [appliedKeyword, setAppliedKeyword] = useState('')

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
    setAppliedKeyword('')
  }, [keyword])

  const applyResult = useCallback(
    (result: SearchResult) => {
      if (tab === 'songs') {
        setSongs(sortSongsByRelevance(result.songs ?? [], keyword))
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
    [keyword, tab],
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
      setAppliedKeyword(keyword)
      applyResult(cached)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    const pageSize =
      tab === 'songs'
        ? songPageSize(keyword)
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
        setAppliedKeyword(keyword)
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
    // Never start before the song list for this keyword has been applied: an
    // early start is aborted by the fetch effect's `loading` flip and used to
    // leave the fallback permanently blocked.
    if (appliedKeyword !== query) return
    if (hasDirectMatch(songsRef.current, query, searchMode)) {
      setDeepSongs([])
      deepKeywordRef.current = ''
      return
    }
    // The run key carries the mode: switching between 歌手 / 专辑 must re-run the
    // fallback for the same query instead of reusing the previous result.
    const runKey = `${searchMode}:${query}`
    if (deepKeywordRef.current === runKey) return
    deepKeywordRef.current = runKey

    const controller = new AbortController()
    const startedWith = runKey
    setDeepLoading(true)
    setDeepSongs([])
    deepSearchSongs(query, controller.signal, searchMode)
      .then((hits) => {
        if (controller.signal.aborted) return
        // Keep every hit, including rows the song index already returned: the
        // merged list below moves them to the top (that is the whole point —
        // the original is usually on page 10 of the cover results, not on page
        // one). Duplicates are removed once, when merging.
        setDeepSongs(hits)
      })
      .catch(() => undefined)
      .finally(() => {
        // Even after an abort the spinner must stop; a new run for another
        // keyword will set it again.
        if (deepKeywordRef.current === startedWith) setDeepLoading(false)
      })
    return () => {
      controller.abort()
      // An aborted run must be restartable once the fetch settles.
      if (deepKeywordRef.current === startedWith) deepKeywordRef.current = ''
    }
  }, [
    tab,
    page,
    keyword,
    loading,
    failed,
    deepEnabled,
    searchMode,
    refreshToken,
    appliedKeyword,
  ])

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
      ? songPageSize(keyword)
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
                    <Trans>这些歌曲来自相关专辑（部分已下架），仍可通过换源播放</Trans>
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
