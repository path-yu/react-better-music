import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Disc3,
  Film,
  Heart,
  ListMusic,
  Loader2,
  MessageSquareText,
} from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { LyricsPanel } from './LyricsPanel'
import AmbientBackground from './AmbientBackground'
import { MvVideoPlayer } from '../mv/MvVideoPlayer'
import { CommentSection } from '../comments/CommentSection'
import { fetchMvUrl, fetchRelatedVideos } from '../../api'
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
  type Palette,
} from '../../lib/color'
import { resizedImageUrl } from '../../lib/image'
import { toast } from '../../lib/toast'
import { cn } from '../../lib/format'

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
  // Playback progress changes several times per second; keep the overlay from
  // re-rendering while it is closed.
  const currentTime = usePlayerStore((state) =>
    state.showNowPlaying ? state.currentTime : 0,
  )
  const lyricLines = usePlayerStore((state) => state.lyricLines)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const ensureLyrics = usePlayerStore((state) => state.ensureLyrics)
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
  const setVideoActive = useVideoPlaybackStore((state) => state.setActive)
  const bindVideo = useVideoPlaybackStore((state) => state.bind)
  const backdrop =
    useSettingsStore((state) => state.nowPlayingBackdrop) ?? 'gradient'
  const nowPlayingMode = useSettingsStore((state) => state.nowPlayingMode)
  const setNowPlayingMode = useSettingsStore(
    (state) => state.setNowPlayingMode,
  )
  const [panel, setPanel] = useState<'lyrics' | 'comments'>('lyrics')
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE)
  const [videoLoading, setVideoLoading] = useState(false)
  const [mvMode, setMvMode] = useState(false)
  const [mvUrl, setMvUrl] = useState('')
  const [mvLoading, setMvLoading] = useState(false)
  const [mvFailed, setMvFailed] = useState(false)
  const mvWasPlayingRef = useRef(false)
  const videoEndedSongRef = useRef<number | null>(null)
  const mvUrlCacheRef = useRef<{ songId: number; url: string; at: number } | null>(
    null,
  )
  const mvId = currentSong?.mv ?? currentSong?.mvid
  const hasMv = Boolean(mvId && Number(mvId) > 0)
  // The CDN URLs returned by the API are HTTP; WebView2 rejects them as mixed
  // content. Normalise to a secure, smaller copy before colour sampling.
  const ambientSource = useMemo(
    () => resizedImageUrl(artwork, '640y640') ?? artwork,
    [artwork],
  )

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
    useVideoPlaybackStore.getState().setActive(false)
    bindVideo(null)
    mvWasPlayingRef.current = false
    videoEndedSongRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id])

  useEffect(() => {
    if (show) return
    setVideoActive(false)
    if (mvMode) {
      setMvMode(false)
      setMvUrl('')
      if (mvWasPlayingRef.current) usePlayerStore.getState().setPlaying(true)
      mvWasPlayingRef.current = false
    }
  }, [show, mvMode, setVideoActive])

  // If the user last chose video mode, keep that preference for every
  // following track that has an MV. This also restores the video view when the
  // immersive player is reopened in a later session.
  useEffect(() => {
    if (
      !show ||
      mvMode ||
      mvLoading ||
      nowPlayingMode !== 'video' ||
      !hasMv ||
      videoEndedSongRef.current === currentSong?.id
    ) {
      return
    }
    void openMvMode()
    // openMvMode intentionally reads the latest song/mv state on each track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, currentSong?.id, hasMv, mvLoading, mvMode, nowPlayingMode])

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

  // Only reset when the artwork changes; reopening the same song keeps the
  // cached palette instead of flashing back to the un-tinted backdrop.
  useEffect(() => {
    setPalette(FALLBACK_PALETTE)
  }, [artwork])

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

  if (!show || !currentSong) return null

  const loadingSource = playing && !sourceReady
  const buffering = playing && sourceReady && !audioReady
  const busy = loadingSource || buffering
  // The backdrop is heavily blurred, so a 320px copy is indistinguishable from
  // the original but avoids fetching/decoding a multi-megapixel cover.
  const ambientArtwork = resizedImageUrl(artwork, '320y320')

  const albumId = currentSong.al.id
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
    useVideoPlaybackStore.getState().setActive(false)
    bindVideo(null)
    if (rememberAudio) setNowPlayingMode('audio')
    if (resumeAudio && mvWasPlayingRef.current) {
      usePlayerStore.getState().setPlaying(true)
    }
    mvWasPlayingRef.current = false
  }

  const openMvMode = async () => {
    if (mvMode || !hasMv || !mvId) return
    mvWasPlayingRef.current = usePlayerStore.getState().playing
    usePlayerStore.getState().setPlaying(false)
    setMvMode(true)
    setMvFailed(false)
    useVideoPlaybackStore.getState().setActive(true)

    // Reopening the play page should not show a cover/poster loading flash or
    // refetch the same URL. A ten-minute cache is enough for the signed MV URL.
    const cached = mvUrlCacheRef.current
    if (
      cached &&
      cached.songId === currentSong.id &&
      Date.now() - cached.at < 10 * 60 * 1000
    ) {
      setMvUrl(cached.url)
      setMvLoading(false)
      return
    }

    setMvLoading(true)
    try {
      // The song's raw `mv` can point at a programme/teaser clip. Resolve the
      // official MV through search first, then request that video's URL.
      const related = await fetchRelatedVideos(currentSong, 12)
      const official = related.find((video) => video.kind === 'mv')
      if (!official) throw new Error('no official mv')
      const url = await fetchMvUrl(official.id)
      if (!url) throw new Error('empty mv url')
      mvUrlCacheRef.current = {
        songId: currentSong.id,
        url,
        at: Date.now(),
      }
      setMvUrl(url)
    } catch {
      setMvFailed(true)
      toast.error(i18n._(msg`MV 加载失败`))
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
      className="nowplaying-overlay dark"
      style={{ backgroundColor: 'var(--nowplaying-base, #0f0f12)' }}
    >
      {backdrop === 'gradient' ? (
        <AmbientBackground
          artwork={ambientSource ?? ''}
          palette={palette}
          playing={playing}
        />
      ) : (
        <div className="nowplaying-ambient" aria-hidden="true">
          {ambientArtwork ? (
            <img
              src={ambientArtwork}
              alt=""
              decoding="async"
              className="nowplaying-ambient__art"
            />
          ) : null}
          <div className="nowplaying-ambient__scrim" />
        </div>
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
            {mvLoading ? null : mvFailed ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-white/55">
                <p className="text-[12px]">
                  <Trans>MV 加载失败</Trans>
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
                onPlay={() => usePlayerStore.getState().setPlaying(false)}
                onEnded={() => {
                  videoEndedSongRef.current = currentSong.id
                  closeMvMode(true, false)
                }}
              />
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 top-10 z-20 flex justify-end bg-gradient-to-b from-black/50 via-black/15 to-transparent px-5 pb-10 pt-2">
              <button
                type="button"
                onClick={() => closeMvMode()}
                className="np-round-button pressable pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-white/75"
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
                    className="np-mv-badge shrink-0 rounded-[4px] border-0 bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent shadow-[0_2px_10px_rgba(0,0,0,0.18)] backdrop-blur-md transition-colors hover:bg-black/55"
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
                  className="np-round-button pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white disabled:opacity-50"
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
                <span className="mx-2 text-black/20">·</span>
                <button
                  type="button"
                  onClick={openAlbum}
                  disabled={!albumId}
                  className="pressable rounded-[6px] underline-offset-2 transition-colors hover:text-white hover:underline disabled:cursor-default cursor-pointer"
                >
                  {currentSong.al.name}
                </button>
              </p>
              {/* Fixed-height status slot: the text appears/disappears while the
                  column is vertically centered, so mounting it conditionally
                  would push the content up and down on every play/pause. */}
              <div className="mt-2 flex h-5 items-center justify-center" aria-live="polite">
                {busy ? (
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
          <div
            className={cn(
              'relative flex min-h-0 flex-col rounded-[22px] max-md:min-h-[420px]',
              panel === 'comments' && 'border border-white/60 bg-white/45 backdrop-blur-xl',
            )}
          >
            <div className="flex flex-none items-center px-3 py-2">
              <div
                className="np-segmented"
                role="tablist"
                aria-label={i18n._(msg`歌词与评论`)}
              >
                <span
                  aria-hidden="true"
                  className="np-segmented__pill"
                  data-active={panel}
                />
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'lyrics'}
                  onClick={() => setPanel('lyrics')}
                  className={cn('np-segmented__item', panel === 'lyrics' && 'is-active')}
                >
                  <Trans>歌词</Trans>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'comments'}
                  onClick={() => setPanel('comments')}
                  className={cn('np-segmented__item', panel === 'comments' && 'is-active')}
                >
                  <MessageSquareText className="h-3 w-3" />
                  <Trans>评论</Trans>
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
    </div>
  )
}
