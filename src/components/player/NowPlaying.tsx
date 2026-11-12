import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Disc3,
  Film,
  GripVertical,
  Heart,
  ListMusic,
  Loader2,
  LocateFixed,
  Search,
  Volume2,
  X,
} from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { menuSurfaceStyle } from '../../lib/menuSurface'
import { LyricsPanel } from './LyricsPanel'
import { LyricStage } from './LyricStage'
import AmbientBackground from './AmbientBackground'
import { FogBackground } from './FogBackground'
import { MvVideoPlayer } from '../mv/MvVideoPlayer'
import { CommentSection, useCommentTotal } from '../comments/CommentSection'
import { SongContextMenu } from '../songs/SongContextMenu'
import { fetchMvUrl, fetchRelatedVideos } from '../../api'
import { useDelayedBusy } from '../../lib/useDelayedBusy'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import { useSettingsStore } from '../../store/settings'
import { findLyricIndex } from '../../lib/lyric'
import { seekAudio } from '../../lib/audio'
import {
  FALLBACK_PALETTE,
  extractPalette,
  withAlpha,
  type Palette,
} from '../../lib/color'
import { resizedImageUrl } from '../../lib/image'
import { toast } from '../../lib/toast'
import { cn, formatDuration, matchesKeyword } from '../../lib/format'
import type { Song } from '../../types'

type NowPlayingPanel = 'lyrics' | 'stage' | 'queue' | 'wall' | 'comments'

function formatCommentCount(value: number, locale: string) {
  if (value < 1000) return String(value)
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

const SONG_TILE_MIN = 112
const SONG_TILE_GAP = 14

export function NowPlaying() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const show = usePlayerStore((state) => state.showNowPlaying)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  // Backdrop follows the current cover; the colour wash is sampled from it.
  const artwork = currentSong?.al.picUrl
  const playing = usePlayerStore((state) => state.playing)
  const audioReady = usePlayerStore((state) => state.audioReady)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const busyVisible = useDelayedBusy(
    playing && (!sourceReady || !audioReady),
  )
  // Playback progress changes several times per second; keep the overlay from
  // re-rendering while it is closed.
  const currentTime = usePlayerStore((state) =>
    state.showNowPlaying ? state.currentTime : 0,
  )
  const lyricLines = usePlayerStore((state) => state.lyricLines)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const playAt = usePlayerStore((state) => state.playAt)
  const moveQueueItem = usePlayerStore((state) => state.moveQueueItem)
  const ensureLyrics = usePlayerStore((state) => state.ensureLyrics)
  const commentTotal = useCommentTotal(0, currentSong?.id ?? 0, show)
  const likedIds = useUserStore((state) => state.likedIds)
  const isLogin = useUserStore((state) => state.isLogin)
  const likeSong = useUserStore((state) => state.likeSong)
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const toggleLocalFavorite = useLocalLibraryStore((state) => state.toggleFavorite)
  const liked = currentSong
    ? isLogin
      ? likedIds.includes(currentSong.id)
      : localFavorites.some((song) => song.id === currentSong.id)
    : false
  const bindVideo = useVideoPlaybackStore((state) => state.bind)
  const nowPlayingMode = useSettingsStore((state) => state.nowPlayingMode)
  const setNowPlayingMode = useSettingsStore(
    (state) => state.setNowPlayingMode,
  )
  const fogBackdrop = useSettingsStore((state) => state.fogBackdrop)
  const [panel, setPanel] = useState<NowPlayingPanel>('lyrics')
  const [queueContext, setQueueContext] = useState<{
    song: Song
    x: number
    y: number
  } | null>(null)
  const queueScrollRef = useRef<HTMLDivElement>(null)
  const queueListRef = useRef<HTMLDivElement>(null)
  const [queueWidth, setQueueWidth] = useState(0)
  const [queueSearch, setQueueSearch] = useState('')
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(
    null,
  )
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState<number | null>(
    null,
  )
  const [queueDropPosition, setQueueDropPosition] = useState<'before' | 'after'>(
    'before',
  )
  const justDraggedRef = useRef(false)
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE)
  const [videoLoading, setVideoLoading] = useState(false)
  const [mvMode, setMvMode] = useState(false)
  const [mvUrl, setMvUrl] = useState('')
  const [mvLoading, setMvLoading] = useState(false)
  const [mvFailed, setMvFailed] = useState(false)
  const [mvVideoReady, setMvVideoReady] = useState(false)
  const mvWasPlayingRef = useRef(false)
  const videoEndedSongRef = useRef<number | null>(null)
  const mvUrlCacheRef = useRef<{ songId: number; url: string; at: number } | null>(
    null,
  )
  // Some songs in the queue do not carry `mv`/`mvid`, even though an official
  // MV exists. Discover it from the same related-video search used by the film
  // button so the direct MV badge can still appear.
  const relatedMvCacheRef = useRef(new Map<number, number | null>())
  const [relatedMv, setRelatedMv] = useState<{
    songId: number
    id: number | null
  } | null>(null)
  const rawMvId = currentSong?.mv ?? currentSong?.mvid
  // `mv: 0` is a valid "no MV" marker, not a nullish value. Treat it as absent
  // so a discovered related MV can fill the gap.
  const mvId = rawMvId && Number(rawMvId) > 0 ? rawMvId : undefined
  const relatedMvId =
    currentSong && relatedMv?.songId === currentSong.id
      ? relatedMv.id
      : null
  const effectiveMvId = mvId ?? relatedMvId
  const hasMv = Boolean(effectiveMvId && Number(effectiveMvId) > 0)
  // The CDN URLs returned by the API are HTTP; WebView2 rejects them as mixed
  // content. Normalise to a secure, smaller copy before colour sampling.
  const ambientSource = useMemo(
    () => resizedImageUrl(artwork, '640y640') ?? artwork,
    [artwork],
  )

  // Measure the picker once before laying out rows. Only visible rows are
  // mounted below, so a 1000+ song queue does not create thousands of covers.
  useEffect(() => {
    if (panel !== 'wall') return
    const element = queueScrollRef.current
    if (!element) return
    const updateWidth = () => setQueueWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panel])

  const queueInnerWidth = Math.max(0, queueWidth - 16)
  const queueColumns = Math.max(
    1,
    Math.floor((queueInnerWidth + SONG_TILE_GAP) / (SONG_TILE_MIN + SONG_TILE_GAP)),
  )
  const queueTileWidth = Math.min(SONG_TILE_MIN, queueInnerWidth)
  const queueRowHeight = Math.max(80, queueTileWidth + SONG_TILE_GAP)
  const queueRowCount = Math.ceil(queue.length / queueColumns)
  const queueVirtualizer = useVirtualizer({
    count: panel === 'wall' && queueWidth > 0 ? queueRowCount : 0,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => queueRowHeight,
    overscan: 4,
  })
  const queueEntries = useMemo(() => {
    const query = queueSearch.trim()
    return queue
      .map((song, index) => ({ song, index }))
      .filter(
        ({ song }) =>
          !query ||
          matchesKeyword(
            query,
            song.name,
            song.al.name,
            song.ar.map((artist) => artist.name).join(' '),
          ),
      )
  }, [queue, queueSearch])
  const queueListVirtualizer = useVirtualizer({
    count: panel === 'queue' ? queueEntries.length : 0,
    getScrollElement: () => queueListRef.current,
    estimateSize: () => 58,
    overscan: 8,
  })
  const measureQueue = queueVirtualizer.measure
  useEffect(() => {
    if (panel !== 'wall') return
    measureQueue()
  }, [panel, queueColumns, queueRowHeight, measureQueue])



  // The overlay is lazy-mounted only while open, so the first effect run is the
  // mount itself — not a navigation. Only close on a real pathname change.
  const initialPathRef = useRef(pathname)
  useEffect(() => {
    if (pathname === initialPathRef.current) return
    initialPathRef.current = pathname
    if (show) toggleNowPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Retry when the overlay opens: a startup fetch may have failed while the
  // API was still booting, and this also covers songs restored from storage.
  useEffect(() => {
    if (show) void ensureLyrics()
  }, [show, ensureLyrics])

  useEffect(() => {
    setPanel('lyrics')
    if (mvMode && mvWasPlayingRef.current) {
      // Leaving video mode by changing tracks should continue with the new
      // song's audio rather than leaving playback paused.
      usePlayerStore.getState().setPlaying(true)
    }
    setMvMode(false)
    setMvUrl('')
    setMvFailed(false)
    setMvLoading(false)
    setMvVideoReady(false)
    useVideoPlaybackStore.getState().setActive(false)
    bindVideo(null)
    mvWasPlayingRef.current = false
    videoEndedSongRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id])

  // If the user last chose video mode, keep that preference for every
  // following track that has an MV. This also restores the video view when the
  // immersive player is reopened in a later session.
  useEffect(() => {
    if (
      !show ||
      mvMode ||
      mvLoading ||
      mvFailed ||
      nowPlayingMode !== 'video' ||
      !hasMv ||
      videoEndedSongRef.current === currentSong?.id
    ) {
      return
    }
    void openMvMode()
    // openMvMode intentionally reads the latest song/mv state on each track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, currentSong?.id, hasMv, mvLoading, mvFailed, mvMode, nowPlayingMode])

  useEffect(() => {
    if (!mvMode || !mvUrl) return
    // VideoSkin mounts the real <video> element after its player context is
    // ready, so retry briefly instead of assuming it exists on the next tick.
    let timer = 0
    let attempts = 0
    let cancelled = false
    const attach = () => {
      if (cancelled) return
      const video =
        document.querySelector<HTMLVideoElement>('.np-video-player video')
      if (video) {
        bindVideo(video)
        return
      }
      if (attempts++ >= 20) return
      timer = window.setTimeout(attach, 50)
    }
    attach()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      bindVideo(null)
    }
  }, [bindVideo, mvMode, mvUrl])

  // Preload the cover thumbnails and sample the artwork palette so both the
  // animated mesh and the blurred-cover backdrop are ready as soon as the
  // track changes.
  useEffect(() => {
    if (!ambientSource) return
    let active = true
    const timer = window.setTimeout(() => {
      if (!active) return
      const preload = (url?: string | null) => {
        if (!url) return
        const image = new Image()
        image.decoding = 'async'
        image.src = url
      }
      preload(resizedImageUrl(artwork, '320y320'))
      preload(ambientSource)
      void extractPalette(ambientSource).then((nextPalette) => {
        if (active) setPalette(nextPalette)
      })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [ambientSource, artwork])

  // Resolve a missing `mv` field through search. The badge is shown as soon as
  // an official MV is found and the result is cached for this session.
  useEffect(() => {
    if (!show || !currentSong || (mvId && Number(mvId) > 0)) return
    const song = currentSong
    const cached = relatedMvCacheRef.current.get(song.id)
    if (cached !== undefined) {
      setRelatedMv({ songId: song.id, id: cached })
      return
    }
    let active = true
    void fetchRelatedVideos(song, 3, undefined, true)
      .then((videos) => {
        if (!active) return
        const official = videos.find((video) => video.kind === 'mv')
        const parsedId = official ? Number(official.id) : null
        const id =
          parsedId !== null && Number.isFinite(parsedId) ? parsedId : null
        relatedMvCacheRef.current.set(song.id, id)
        setRelatedMv({ songId: song.id, id })
      })
      .catch(() => {
        if (!active) return
        relatedMvCacheRef.current.set(song.id, null)
        setRelatedMv({ songId: song.id, id: null })
      })
    return () => {
      active = false
    }
    // `currentSong` changes on lyric patches; only its id affects the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, currentSong?.id, mvId])

  // Preload the next track's cover while the current one plays.
  const nextArtwork = queue[currentIndex + 1]?.al.picUrl
  useEffect(() => {
    if (!nextArtwork) return
    const urls = [
      resizedImageUrl(nextArtwork, '320y320'),
      resizedImageUrl(nextArtwork, '640y640'),
    ]
    for (const url of urls) {
      if (!url) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = url
    }
  }, [nextArtwork])

  useEffect(() => {
    if (!show) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The queue panel is stacked above this view and handles Escape itself.
      if (usePlayerStore.getState().showQueue) return
      toggleNowPlaying(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [show, toggleNowPlaying])

  // Apple Music's lyrics screen is literally the artwork: the container carries
  // `background-image: url(cover)` + `background-color: var(--nowPlayingBackdropBG)`
  // and `.now-playing-structure` lays a `linear-gradient(0deg,#0006,#0000 50%)`
  // scrim on top. No white veil, no extra tints.

  const activeIndex = useMemo(
    () => findLyricIndex(lyricLines, currentTime * 1000),
    [lyricLines, currentTime],
  )

  // Stable identity keeps the memoised lyric list from re-rendering on every
  // playback tick. Must stay above the early return (rules of hooks).
  const handleSeek = useCallback((timeMs: number) => {
    seekAudio(timeMs / 1000)
  }, [])

  // Keep the MV mounted while the detail page is collapsed so closing the
  // overlay only hides the UI instead of stopping the video. Audio-only views
  // can unmount normally, and the WebGL fog is still gated by `show` below.
  if (!currentSong || (!show && !mvMode)) return null

  const loadingSource = playing && !sourceReady
  // The backdrop is heavily blurred, so a 320px copy is indistinguishable from
  // the original but avoids fetching/decoding a multi-megapixel cover.


  const albumId = currentSong.al.id
  // A self-titled album is the same string as the artist; repeating it makes the
  // metadata read like a bug. The cover still links to the album.
  const artistLabel = currentSong.ar
    .map((artist) => artist.name)
    .join(' / ')
    .trim()
    .toLowerCase()
  const showAlbumMeta =
    Boolean(currentSong.al.name.trim()) &&
    currentSong.al.name.trim().toLowerCase() !== artistLabel
  const openAlbum = () => {
    if (!albumId) return
    // Close first: the router may commit the album route only after its data
    // resolves, so relying on the pathname effect would leave this overlay on
    // top of the page the user just asked for (and it never fires when the
    // album is already the current path).
    toggleNowPlaying(false)
    void navigate({ to: '/albums/$id', params: { id: String(albumId) } })
  }

  const closeMvMode = (resumeAudio = true, rememberAudio = true) => {
    setMvMode(false)
    setMvUrl('')
    setMvFailed(false)
    setMvLoading(false)
    setMvVideoReady(false)
    useVideoPlaybackStore.getState().setActive(false)
    bindVideo(null)
    if (rememberAudio) setNowPlayingMode('audio')
    if (resumeAudio && mvWasPlayingRef.current) {
      usePlayerStore.getState().setPlaying(true)
    }
    mvWasPlayingRef.current = false
  }

  const enterMvMode = (url: string) => {
    // Only pause audio after a playable URL exists. Entering a black video
    // surface first would leave the user stuck there when the MV is gone.
    mvWasPlayingRef.current = usePlayerStore.getState().playing
    usePlayerStore.getState().setPlaying(false)
    setMvMode(true)
    setMvFailed(false)
    setMvVideoReady(false)
    useVideoPlaybackStore.getState().setActive(true)
    setMvUrl(url)
  }

  const openMvMode = async () => {
    if (mvMode || !hasMv || !effectiveMvId) return
    setMvLoading(true)
    setMvFailed(false)
    setMvVideoReady(false)
    setMvUrl('')

    // Reopening the play page should not show a cover/poster loading flash or
    // refetch the same URL. A ten-minute cache is enough for the signed MV URL.
    const cached = mvUrlCacheRef.current
    if (
      cached &&
      cached.songId === currentSong.id &&
      Date.now() - cached.at < 10 * 60 * 1000
    ) {
      enterMvMode(cached.url)
      setMvLoading(false)
      return
    }

    try {
      let officialId = Number(effectiveMvId)
      // A discovered MV is already the matched official result. When only the
      // song's raw `mv` field exists, prefer an exact search match and fall
      // back to the raw id if search is unavailable.
      if (!relatedMvId) {
        try {
          const related = await fetchRelatedVideos(
            currentSong,
            3,
            undefined,
            true,
          )
          const official = related.find((video) => video.kind === 'mv')
          if (official) officialId = Number(official.id)
        } catch {
          // Keep the raw `mv` id as the fallback.
        }
      }
      if (!officialId) throw new Error('no official mv')
      const url = await fetchMvUrl(officialId)
      if (!url) throw new Error('empty mv url')
      mvUrlCacheRef.current = {
        songId: currentSong.id,
        url,
        at: Date.now(),
      }
      enterMvMode(url)
    } catch {
      // Stay on the audio page; the URL probe rejected a removed/region-locked
      // MV before mounting a <video> element.
      setMvFailed(true)
      setNowPlayingMode('audio')
      toast.info(
        i18n._(msg`视频暂时无法播放，可能已下架或存在地区限制`),
      )
    } finally {
      setMvLoading(false)
    }
  }

  const toggleMvMode = async () => {
    if (mvMode) {
      closeMvMode()
      return
    }
    videoEndedSongRef.current = null
    setNowPlayingMode('video')
    await openMvMode()
  }

  const openRelatedVideos = async () => {
    if (videoLoading) return
    setVideoLoading(true)
    try {
      const videos = await fetchRelatedVideos(currentSong, 12)
      if (!videos.length) {
        toast.info(i18n._(msg`暂无相关视频`))
        return
      }
      const first = videos[0]
      toggleNowPlaying(false)
      if (first.kind === 'mv') {
        void navigate({ to: '/mv/$id', params: { id: String(first.id) } })
        return
      }
      void navigate({
        to: '/video/$id',
        params: { id: String(first.id) },
        search: {
          kind: first.kind,
          title: first.title,
          cover: first.cover ?? '',
          artist: first.artist ?? '',
          duration: first.duration ?? 0,
        },
      })
    } catch {
      toast.error(i18n._(msg`相关视频加载失败`))
    } finally {
      setVideoLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'nowplaying-overlay dark',
        // `opacity-0` rather than `display:none`: WebView2 keeps decoding and
        // playing the <video> audio while the overlay is invisible.
        !show && 'pointer-events-none opacity-0',
      )}
      style={{ backgroundColor: 'var(--nowplaying-base, #0f0f12)' }}
      aria-hidden={!show}
    >
      {/*
        Keep the WebGL canvas alive only while the detail page is actually
        visible. Keeping a full-screen WebGL context around for the whole
        session wastes GPU resources and makes a renderer/GPU crash more likely.
      */}
      {!show ? null : fogBackdrop ? (
        <FogBackground
          tint={palette.colors[0]}
          playing={playing}
          fallback={
            <AmbientBackground
              artwork={ambientSource ?? ''}
              palette={palette}
              playing={playing}
            />
          }
        />
      ) : (
        <AmbientBackground
          artwork={ambientSource ?? ''}
          palette={palette}
          playing={playing}
        />
      )}

      {/* The player bar floats over the bottom of the backdrop, so keep the
          immersive content clear of it. */}
      <div className="np-content-enter relative flex h-full flex-col pb-[76px]">
        <div
          className={cn(
            'flex h-[58px] flex-none items-center justify-between px-6',
            mvMode && 'hidden',
          )}
        >
          {/* <button
            type="button"
            aria-label={i18n._(msg`收起播放页`)}
            title={i18n._(msg`收起播放页（Esc）`)}
            onClick={() => toggleNowPlaying(false)}
            className="np-round-button  flex h-9 w-9 items-center justify-center rounded-full text-white/75 max-md:h-10 max-md:w-10"
          >
            <ChevronDown className="h-4 w-4" />
          </button> */}

          {/* The floating player bar already exposes like/queue on desktop; on
              mobile it hides both, so this row is their only entry point. */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
              aria-pressed={liked}
              title={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
              onClick={() => {
                if (isLogin) void likeSong(currentSong.id, !liked)
                else void toggleLocalFavorite(currentSong)
              }}
              className="np-round-button pressable flex h-10 w-10 items-center justify-center rounded-full"
            >
              <Heart
                className={cn(
                  'h-4 w-4',
                  liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-white/60',
                )}
              />
            </button>
            <button
              type="button"
              aria-label={i18n._(msg`播放列表`)}
              title={i18n._(msg`播放列表`)}
              onClick={() => toggleQueue(true)}
              className="np-round-button pressable flex h-10 w-10 items-center justify-center rounded-full text-white/70"
            >
              <ListMusic className="h-4 w-4" />
            </button>
          </div>
        </div>

        {mvMode ? (
          <div className="np-video-player relative min-h-0 flex-1 overflow-hidden bg-black">
            {mvFailed ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-white/55">
                <p className="max-w-[280px] text-center text-[12px]">
                  <Trans>视频暂时无法播放，可能已下架或存在地区限制</Trans>
                </p>
                <button
                  type="button"
                  onClick={() => closeMvMode()}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/10"
                >
                  <Trans>返回音乐</Trans>
                </button>
              </div>
            ) : mvUrl ? (
              <MvVideoPlayer
                key={mvUrl}
                src={mvUrl}
                autoPlay
                fill
                onReady={() => setMvVideoReady(true)}
                onError={() => {
                  setMvVideoReady(false)
                  setMvFailed(true)
                }}
                onPlay={() => usePlayerStore.getState().setPlaying(false)}
                onEnded={() => {
                  videoEndedSongRef.current = currentSong.id
                  closeMvMode(true, false)
                }}
              />
            ) : null}

            {/* The URL request and the first video segment are separate waits.
                Keep a spinner over the black frame until `canplay` fires. */}
            {!mvFailed && !mvVideoReady ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/25 text-white/70">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <p className="text-[12px]">
                  {mvLoading ? (
                    <Trans>正在获取 MV…</Trans>
                  ) : (
                    <Trans>视频加载中…</Trans>
                  )}
                </p>
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 top-10 z-20 flex justify-end px-5">

              <button
                type="button"
                onClick={() => closeMvMode()}
                aria-label={i18n._(msg`返回音乐`)}
                title={i18n._(msg`返回音乐`)}
                // The MV can have a white/bright frame; a transparent glass
                // pill leaves this white icon invisible. Keep a dark scrim.
                className="np-round-button pressable pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full border-white/15 bg-black/45 px-3 py-1.5 text-[11px] text-white shadow-[0_4px_18px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-black/65"
              >
                <Disc3 className="h-3.5 w-3.5" />
                <Trans>音乐</Trans>
              </button>
            </div>
          </div>
        ) : (
          <>
        {/* Desktop: the columns own their scrolling (lyrics/comments), so the
            page itself never scrolls and the wheel target stays predictable.
            Mobile: one single scroll container for the whole page. */}
        <div className="grid flex-1 grid-cols-1 gap-4 px-6 pb-5 max-md:overflow-y-auto md:grid-cols-[minmax(220px,0.9fr)_minmax(250px,1.1fr)] md:overflow-hidden xl:gap-6 xl:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-h-0 flex-col items-center justify-center">
            <div className="max-w-[360px] text-center">
              <div className="flex min-w-0 items-center justify-center gap-1.5">
                <h2 className="headline-lg np-track-heading min-w-0 truncate text-[24px]">{currentSong.name}</h2>
                {hasMv ? (
                  <button
                    type="button"
                    aria-label={i18n._(msg`切换到视频播放`)}
                    title={i18n._(msg`切换到视频播放`)}
                    aria-pressed={mvMode}
                    onClick={() => void toggleMvMode()}
                    className="np-mv-badge  shrink-0 rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent transition-colors hover:bg-white/10"
                  >
                    MV
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={i18n._(msg`相关视频`)}
                  title={i18n._(msg`相关视频`)}
                  disabled={videoLoading}
                  onClick={() => void openRelatedVideos()}
                  className=" np-round-button pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white disabled:opacity-50"
                >
                  {videoLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4" />
                  )}
                </button>
              </div>
              {currentSong.alia?.[0] ? (
                <p className="mt-1 truncate text-[12px] text-black/35">{currentSong.alia[0]}</p>
              ) : null}
              <p className="np-track-meta mt-2 text-[13px] text-black/45">
                <ArtistLinks artists={currentSong.ar} />
                {showAlbumMeta ? (
                  <>
                    <span className="mx-2 text-black/20">·</span>
                    <button
                      type="button"
                      onClick={openAlbum}
                      disabled={!albumId}
                      className="pressable rounded-[6px] underline-offset-2 transition-colors hover:text-white hover:underline disabled:cursor-default cursor-pointer"
                    >
                      {currentSong.al.name}
                    </button>
                  </>
                ) : null}
              </p>
              {/* Fixed-height status slot: the text appears/disappears while the
                  column is vertically centered, so mounting it conditionally
                  would push the content up and down on every play/pause. */}
              <div className="mt-2 flex h-5 items-center justify-center" aria-live="polite">
                {busyVisible ? (
                  <span
                    className="flex items-center gap-1.5 text-[12px] text-accent"
                    role="status"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {loadingSource ? <Trans>正在加载音源…</Trans> : <Trans>正在缓冲…</Trans>}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="relative mt-6 flex items-center justify-center">
              <div className="now-disc relative">
                {palette.colors[0] ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-5 rounded-[28px] opacity-40 blur-2xl transition-colors duration-500"
                    style={{ backgroundColor: palette.colors[0] }}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={openAlbum}
                  disabled={!albumId}
                  aria-label={
                    albumId
                      ? i18n._(msg`打开专辑 ${currentSong.al.name}`)
                      : undefined
                  }
                  className="album-cover group relative block h-full w-full cursor-pointer disabled:cursor-default"
                >
                  <ImageWithFallback
                    src={currentSong.al.picUrl}
                    alt={currentSong.name}
                    rounded="rounded-[14px]"
                    className="h-full w-full"
                    resize="640y640"
                  />
                  {/* Hover hint so the cover reads as a link into the album. */}
                  <span className="pointer-events-none absolute inset-0 flex items-end justify-center bg-black/25 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-black/80 shadow-sm">
                      <Disc3 className="h-3.5 w-3.5" />
                      <Trans>查看专辑</Trans>
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-col max-md:min-h-[420px]">
            <div className="flex flex-none items-center px-2 pb-1 pt-6">
              <div
                className="np-tabs"
                role="tablist"
                aria-label={i18n._(msg`歌词、律动、待播清单、选歌与评论`)}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'lyrics'}
                  onClick={() => setPanel('lyrics')}
                  className={cn('np-tab', panel === 'lyrics' && 'is-active')}
                >
                  <Trans>歌词</Trans>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'stage'}
                  onClick={() => setPanel('stage')}
                  className={cn('np-tab', panel === 'stage' && 'is-active')}
                >
                  <Trans>律动</Trans>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'queue'}
                  onClick={() => setPanel('queue')}
                  className={cn('np-tab', panel === 'queue' && 'is-active')}
                >
                  <Trans>待播清单</Trans>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'wall'}
                  onClick={() => setPanel('wall')}
                  className={cn('np-tab', panel === 'wall' && 'is-active')}
                >
                  <Trans>选歌</Trans>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'comments'}
                  onClick={() => setPanel('comments')}
                  className={cn('np-tab', panel === 'comments' && 'is-active')}
                >
                  <Trans>评论</Trans>
                  {commentTotal !== null ? (
                    <span className="np-tab__count">
                      {formatCommentCount(commentTotal, i18n.locale)}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              {panel === 'lyrics' ? (
                lyricLoading && !lyricLines.length ? (
                  <div
                    className="flex h-full flex-col items-center justify-center gap-2.5 text-[12px] text-black/35"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    <Trans>正在加载歌词…</Trans>
                  </div>
                ) : (
                  <LyricsPanel
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    onSeek={handleSeek}
                    className="h-full max-md:h-auto"
                  />
                )
              ) : panel === 'stage' ? (
                lyricLoading && !lyricLines.length ? (
                  <div
                    className="flex h-full flex-col items-center justify-center gap-2.5 text-[12px] text-white/40"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    <Trans>正在加载歌词…</Trans>
                  </div>
                ) : (
                  <LyricStage
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    currentTime={currentTime * 1000}
                    onSeek={handleSeek}
                    className="h-full max-md:h-auto"
                  />
                )
              ) : panel === 'queue' ? (
                <div className="relative flex h-[min(72vh,620px)] min-h-[360px] flex-col md:h-full">
                  <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
                      <input
                        value={queueSearch}
                        onChange={(event) => {
                          setQueueSearch(event.target.value)
                          queueListRef.current?.scrollTo({ top: 0 })
                        }}
                        placeholder={i18n._(msg`搜索待播歌曲`)}
                        aria-label={i18n._(msg`搜索待播歌曲`)}
                        className="h-8 w-full rounded-full bg-white/10 pl-8 pr-7 text-[11.5px] text-white/85 outline-none shadow-none placeholder:text-white/30 focus:bg-white/14"
                      />
                      {queueSearch ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQueueSearch('')
                            queueListRef.current?.scrollTo({ top: 0 })
                          }}
                          aria-label={i18n._(msg`清除搜索`)}
                          className="pressable absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div
                    ref={queueListRef}
                    className="min-h-0 flex-1 overflow-y-auto px-2 pb-16 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {queue.length ? (
                      queueEntries.length ? (
                        <div
                          className="relative w-full"
                          style={{ height: `${queueListVirtualizer.getTotalSize()}px` }}
                        >
                          {queueListVirtualizer.getVirtualItems().map((row) => {
                            const entry = queueEntries[row.index]
                            if (!entry) return null
                            const song = entry.song
                            const originalIndex = entry.index
                            const active = originalIndex === currentIndex
                            return (
                              <div
                                key={`${song.id}-${originalIndex}`}
                                role="button"
                                tabIndex={0}
                                aria-current={active ? 'true' : undefined}
                                onClick={(event) => {
                                  if (justDraggedRef.current) return
                                  // Selection controls live inside the row; a
                                  // click there must never fall through to play.
                                  if (
                                    (event.target as HTMLElement).closest(
                                      'button, a, input, [role="checkbox"]',
                                    )
                                  ) {
                                    return
                                  }
                                  if (!active) void playAt(originalIndex)
                                }}
                                onKeyDown={(event) => {
                                  if (event.target !== event.currentTarget) return
                                  if (event.key !== 'Enter' && event.key !== ' ') {
                                    return
                                  }
                                  event.preventDefault()
                                  if (!active) void playAt(originalIndex)
                                }}
                                onDragStart={(event) => {
                                  if (queueSearch.trim()) return
                                  justDraggedRef.current = true
                                  setDraggedQueueIndex(originalIndex)
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData(
                                    'text/plain',
                                    String(originalIndex),
                                  )
                                }}
                                onDragEnd={() => {
                                  setDraggedQueueIndex(null)
                                  setDragOverQueueIndex(null)
                                  window.setTimeout(() => {
                                    justDraggedRef.current = false
                                  }, 0)
                                }}
                                onDragOver={(event) => {
                                  if (
                                    draggedQueueIndex === null ||
                                    queueSearch.trim()
                                  ) {
                                    return
                                  }
                                  event.preventDefault()
                                  event.dataTransfer.dropEffect = 'move'
                                  const rect =
                                    event.currentTarget.getBoundingClientRect()
                                  setQueueDropPosition(
                                    event.clientY >= rect.top + rect.height / 2
                                      ? 'after'
                                      : 'before',
                                  )
                                  setDragOverQueueIndex(originalIndex)
                                }}
                                onDrop={(event) => {
                                  event.preventDefault()
                                  const from =
                                    draggedQueueIndex ??
                                    Number(event.dataTransfer.getData('text/plain'))
                                  setDraggedQueueIndex(null)
                                  setDragOverQueueIndex(null)
                                  window.setTimeout(() => {
                                    justDraggedRef.current = false
                                  }, 0)
                                  if (!Number.isInteger(from) || from < 0) {
                                    return
                                  }
                                  let targetIndex =
                                    originalIndex +
                                    (queueDropPosition === 'after' ? 1 : 0)
                                  if (from < targetIndex) targetIndex -= 1
                                  if (targetIndex === from) return
                                  moveQueueItem(from, targetIndex)
                                }}
                                onPointerDown={(event) => {
                                  if (event.button !== 2) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setQueueContext({
                                    song,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setQueueContext({
                                    song,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }}
                                className={cn(
                                  'np-queue-row group',
                                  active && 'is-current',
                                  draggedQueueIndex === originalIndex &&
                                    'is-dragging',
                                  dragOverQueueIndex === originalIndex &&
                                    'is-drop-target',
                                )}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  right: 0,
                                  left: 0,
                                  height: `${row.size}px`,
                                  transform: `translateY(${row.start}px)`,
                                  backgroundColor:
                                    active && palette.colors[0]
                                      ? withAlpha(palette.colors[0], 0.16)
                                      : dragOverQueueIndex === originalIndex
                                        ? withAlpha(
                                            palette.colors[0] ?? '#8e8e93',
                                            0.06,
                                          )
                                        : undefined,
                                }}
                              >
                                {dragOverQueueIndex === originalIndex ? (
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      'np-queue-drop-line',
                                      queueDropPosition === 'after' && 'is-after',
                                    )}
                                    style={{
                                      backgroundColor: withAlpha(
                                        palette.colors[0] ?? '#8e8e93',
                                        0.55,
                                      ),
                                    }}
                                  />
                                ) : null}
                                <span
                                  className="np-queue-drag"
                                  draggable={!queueSearch.trim()}
                                  onClick={(event) => event.stopPropagation()}
                                  title={i18n._(msg`拖动排序`)}
                                  aria-label={i18n._(msg`拖动排序`)}
                                  role="img"
                                >
                                  <GripVertical className="h-4 w-4" />
                                </span>
                                <span className="np-queue-row__index">
                                  {active ? (
                                    <Volume2
                                      className="h-3.5 w-3.5"
                                      style={
                                        palette.colors[0]
                                          ? { color: palette.colors[0] }
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    String(originalIndex + 1).padStart(2, '0')
                                  )}
                                </span>
                                <ImageWithFallback
                                  src={song.al.picUrl}
                                  alt={song.name}
                                  rounded="rounded-[7px]"
                                  className="h-[42px] w-[42px] shrink-0"
                                  resize="96y96"
                                />
                                <span className="np-queue-row__text">
                                  <span className="np-queue-row__name">
                                    {song.name}
                                  </span>
                                  <ArtistLinks
                                    artists={song.ar}
                                    className="np-queue-row__artist"
                                  />
                                </span>
                                <span className="np-queue-row__time">
                                  {formatDuration(song.dt)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex h-full min-h-[180px] items-center justify-center text-[12px] text-white/45">
                          <Trans>没有匹配的歌曲</Trans>
                        </div>
                      )
                    ) : (
                      <div className="flex h-full min-h-[180px] items-center justify-center text-[12px] text-white/45">
                        <Trans>播放队列为空</Trans>
                      </div>
                    )}
                  </div>

                  {queueEntries.some((entry) => entry.index === currentIndex) ? (
                    <button
                      type="button"
                      onClick={() => {
                        const position = queueEntries.findIndex(
                          (entry) => entry.index === currentIndex,
                        )
                        if (position >= 0) {
                          queueListVirtualizer.scrollToIndex(position, {
                            align: 'center',
                          })
                        }
                      }}
                      aria-label={i18n._(msg`定位到当前播放`)}
                      title={i18n._(msg`定位到当前播放`)}
                      className="pressable absolute bottom-1.5 right-1.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white/75 shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-colors hover:bg-white/15 hover:text-white"
                    >
                      <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  ) : null}
                </div>
              ) : panel === 'wall' ? (
                <div
                  ref={queueScrollRef}
                  className="h-[min(72vh,620px)] min-h-[360px] overflow-y-auto px-2 pb-8 pt-2 md:h-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {queue.length ? (
                    <div
                      className="relative w-full"
                      style={{ height: `${queueVirtualizer.getTotalSize()}px` }}
                    >
                      {queueVirtualizer.getVirtualItems().map((virtualRow) => {
                        const start = virtualRow.index * queueColumns
                        const rowSongs = queue.slice(start, start + queueColumns)
                        return (
                          <div
                            key={virtualRow.key}
                            className="np-song-row"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              height: `${queueRowHeight}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                              gridTemplateColumns: `repeat(${queueColumns}, ${queueTileWidth}px)`,
                            }}
                          >
                            {rowSongs.map((song, offset) => {
                              const index = start + offset
                              const active = index === currentIndex
                              return (
                                <button
                                  key={`${song.id}-${index}`}
                                  type="button"
                                  title={song.name}
                                  aria-current={active ? 'true' : undefined}
                                  onClick={() => void playAt(index)}
                                  className={cn(
                                    'np-song-tile group',
                                    active && 'is-current',
                                  )}
                                >
                                  <span className="np-song-tile__cover">
                                    <ImageWithFallback
                                      src={song.al.picUrl}
                                      alt={song.name}
                                      rounded="rounded-[12px]"
                                      className="h-full w-full"
                                      resize="240y240"
                                    />
                                    <span className="np-song-tile__caption">
                                      <span className="np-song-tile__name">
                                        {song.name}
                                      </span>
                                      <span className="np-song-tile__artist">
                                        {song.ar
                                          .map((artist) => artist.name)
                                          .join(' / ')}
                                      </span>
                                    </span>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-[12px] text-white/45">
                      <Trans>播放队列为空</Trans>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full overflow-y-auto px-5 pb-8 pt-4 max-md:h-auto max-md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <CommentSection
                    type={0}
                    resourceId={currentSong.id}
                    title={i18n._(msg`歌曲评论`)}
                    showComposer
                  />
                </div>
              )}
            </div>
          </div>
        </div>
          </>
        )}
      </div>

      {queueContext ? (
        <SongContextMenu
          song={queueContext.song}
          liked={
            isLogin
              ? likedIds.includes(queueContext.song.id)
              : localFavorites.some((song) => song.id === queueContext.song.id)
          }
          x={queueContext.x}
          y={queueContext.y}
          onClose={() => setQueueContext(null)}
          dark
          menuStyle={menuSurfaceStyle([
            palette.colors[0] ?? '#232325',
            palette.colors[1] ?? palette.colors[0] ?? '#232325',
          ])}
        />
      ) : null}
    </div>
  )
}
