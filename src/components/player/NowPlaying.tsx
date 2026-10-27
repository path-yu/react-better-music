import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Disc3, Heart, ListMusic, Loader2, MessageSquareText } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { LyricsPanel } from './LyricsPanel'
import { CommentSection } from '../comments/CommentSection'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { findLyricIndex } from '../../lib/lyric'
import { seekAudio } from '../../lib/audio'
import { extractDominantColor } from '../../lib/color'
import { cn } from '../../lib/format'

export function NowPlaying() {
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
  const likeSong = useUserStore((state) => state.likeSong)
  const liked = currentSong ? likedIds.includes(currentSong.id) : false
  const [panel, setPanel] = useState<'lyrics' | 'comments'>('lyrics')
  const [dominantColor, setDominantColor] = useState<string | null>(null)

  useEffect(() => {
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
  }, [currentSong?.id])

  useEffect(() => {
    if (!show) return
    let active = true
    setDominantColor(null)
    void extractDominantColor(artwork).then((color) => {
      if (active) setDominantColor(color)
    })
    return () => {
      active = false
    }
  }, [show, artwork])

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

  if (!show || !currentSong) return null

  const loadingSource = playing && !sourceReady
  const buffering = playing && sourceReady && !audioReady
  const busy = loadingSource || buffering

  const handleSeek = (timeMs: number) => {
    seekAudio(timeMs / 1000)
  }

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

  return (
    <div
      className="nowplaying-overlay dark"
      style={{ backgroundColor: '#0f0f12' }}
    >
      <div
        className="nowplaying-ambient"
        aria-hidden="true"
        style={dominantColor ? { backgroundColor: dominantColor } : undefined}
      >
        {artwork ? (
          <img src={artwork} alt="" className="nowplaying-ambient__art" />
        ) : null}
        <div className="nowplaying-ambient__scrim" />
        <div className="nowplaying-ambient__grain" />
      </div>

      {/* The player bar floats over the bottom of the backdrop, so keep the
          immersive content clear of it. */}
      <div className="relative flex h-full flex-col pb-[76px]">
        <div className="flex h-[58px] flex-none items-center justify-between px-6">
          {/* <button
            type="button"
            aria-label="收起播放页"
            title="收起播放页（Esc）"
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
              aria-label={liked ? '取消喜欢' : '喜欢'}
              aria-pressed={liked}
              title={liked ? '取消喜欢' : '喜欢'}
              onClick={() => void likeSong(currentSong.id, !liked)}
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
              aria-label="播放列表"
              title="播放列表"
              onClick={() => toggleQueue(true)}
              className="np-round-button pressable flex h-10 w-10 items-center justify-center rounded-full text-white/70"
            >
              <ListMusic className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Desktop: the columns own their scrolling (lyrics/comments), so the
            page itself never scrolls and the wheel target stays predictable.
            Mobile: one single scroll container for the whole page. */}
        <div className="grid flex-1 grid-cols-1 gap-4 px-6 pb-5 max-md:overflow-y-auto md:grid-cols-[minmax(220px,0.9fr)_minmax(250px,1.1fr)] md:overflow-hidden xl:gap-6 xl:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-h-0 flex-col items-center justify-center">
            <div className="max-w-[360px] text-center">
              <h2 className="headline-lg truncate text-[24px]">{currentSong.name}</h2>
              {currentSong.alia?.[0] ? (
                <p className="mt-1 truncate text-[12px] text-black/35">{currentSong.alia[0]}</p>
              ) : null}
              <p className="mt-2 text-[13px] text-black/45">
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
                    {loadingSource ? '正在加载音源…' : '正在缓冲…'}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="relative mt-6 flex items-center justify-center">
              <div className="now-disc relative">
                {dominantColor ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-5 rounded-[28px] opacity-40 blur-2xl transition-colors duration-500"
                    style={{ backgroundColor: dominantColor }}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={openAlbum}
                  disabled={!albumId}
                  aria-label={albumId ? `打开专辑 ${currentSong.al.name}` : undefined}
                  className="album-cover group relative block h-full w-full cursor-pointer disabled:cursor-default"
                >
                  <ImageWithFallback
                    src={currentSong.al.picUrl}
                    alt={currentSong.name}
                    rounded="rounded-[14px]"
                    className="h-full w-full"
                    resize="800y800"
                  />
                  {/* Hover hint so the cover reads as a link into the album. */}
                  <span className="pointer-events-none absolute inset-0 flex items-end justify-center bg-black/25 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-black/80 shadow-sm">
                      <Disc3 className="h-3.5 w-3.5" />
                      查看专辑
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
              <div className="np-segmented" role="tablist" aria-label="歌词与评论">
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
                  歌词
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'comments'}
                  onClick={() => setPanel('comments')}
                  className={cn('np-segmented__item', panel === 'comments' && 'is-active')}
                >
                  <MessageSquareText className="h-3 w-3" />
                  评论
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
                    正在加载歌词…
                  </div>
                ) : (
                  <LyricsPanel
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    currentTimeMs={currentTime * 1000}
                    onSeek={handleSeek}
                    className="h-full max-md:h-auto"
                  />
                )
              ) : (
                <div className="h-full overflow-y-auto px-5 pb-8 pt-4 max-md:h-auto max-md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <CommentSection
                    type={0}
                    resourceId={currentSong.id}
                    title="歌曲评论"
                    showComposer
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
