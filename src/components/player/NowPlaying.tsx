import { useEffect, useMemo, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  MessageSquareText,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sun,
} from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { LyricsPanel } from './LyricsPanel'
import { CommentSection } from '../comments/CommentSection'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { findLyricIndex } from '../../lib/lyric'
import { seekAudio } from '../../lib/audio'
import { extractDominantColor, mixColor } from '../../lib/color'
import { cn } from '../../lib/format'

export function NowPlaying() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const show = usePlayerStore((state) => state.showNowPlaying)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const audioReady = usePlayerStore((state) => state.audioReady)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const lyricLines = usePlayerStore((state) => state.lyricLines)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const [panel, setPanel] = useState<'lyrics' | 'comments'>('lyrics')
  const [dominantColor, setDominantColor] = useState<string | null>(null)

  useEffect(() => {
    if (show) toggleNowPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    setPanel('lyrics')
  }, [currentSong?.id])

  useEffect(() => {
    let active = true
    setDominantColor(null)
    void extractDominantColor(currentSong?.al.picUrl).then((color) => {
      if (active) setDominantColor(color)
    })
    return () => {
      active = false
    }
  }, [currentSong?.al.picUrl])

  useEffect(() => {
    if (!show) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleNowPlaying(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [show, toggleNowPlaying])

  const background = useMemo(() => {
    const base = theme === 'dark' ? '#121212' : '#ffffff'
    if (!dominantColor) return base
    const tint = mixColor(dominantColor, base, theme === 'dark' ? 0.42 : 0.28)
    return `linear-gradient(180deg, ${tint} 0%, ${base} 78%, ${base} 100%)`
  }, [dominantColor, theme])

  const veil = useMemo(
    () =>
      theme === 'dark'
        ? 'linear-gradient(180deg, rgba(18,18,18,0.18) 0%, rgba(18,18,18,0.6) 52%, rgba(18,18,18,0.9) 84%, #121212 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.7) 52%, rgba(255,255,255,0.94) 84%, #ffffff 100%)',
    [theme],
  )

  if (!show || !currentSong) return null

  const activeIndex = findLyricIndex(lyricLines, currentTime * 1000)
  const liked = likedIds.includes(currentSong.id)
  const discSpinning = playing && audioReady
  const loadingSource = playing && !sourceReady
  const buffering = playing && sourceReady && !audioReady
  const busy = loadingSource || buffering

  const handleSeek = (timeMs: number) => {
    seekAudio(timeMs / 1000)
  }

  return (
    <div
      className="nowplaying-overlay"
      style={{ backgroundColor: theme === 'dark' ? '#121212' : '#ffffff' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        {currentSong.al.picUrl ? (
          <img
            src={currentSong.al.picUrl}
            alt=""
            aria-hidden
            className="h-full w-full scale-[1.35] object-cover blur-[80px] saturate-150"
            style={{ opacity: theme === 'dark' ? 0.72 : 0.58 }}
          />
        ) : null}
        {dominantColor ? (
          <div
            className="absolute inset-0"
            style={{ background, opacity: theme === 'dark' ? 0.45 : 0.4 }}
          />
        ) : null}
        <div className="absolute inset-0" style={{ background: veil }} />
      </div>

      <div className="relative flex h-full flex-col">
        <div className="flex h-[58px] flex-none items-center justify-between px-6">
          <div>
            <p className="eyebrow">正在播放</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="收起播放页"
              onClick={() => toggleNowPlaying(false)}
              className="pressable flex h-8 items-center gap-1.5 rounded-full bg-black/5 px-3 text-[11px] text-black/55 hover:bg-black/10 hover:text-black"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              收起
            </button>
            <button
              type="button"
              aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              onClick={toggleTheme}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-black/45 hover:bg-black/10 hover:text-black/75"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              aria-label={liked ? '取消喜欢' : '喜欢'}
              onClick={() => void likeSong(currentSong.id, !liked)}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-black/5 hover:bg-black/10"
            >
              <Heart
                className={cn(
                  'h-4 w-4',
                  liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-black/45',
                )}
              />
            </button>
            <button
              type="button"
              aria-label="播放列表"
              onClick={() => toggleQueue(true)}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-black/45 hover:bg-black/10 hover:text-black/75"
            >
              <ListMusic className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 pb-5 md:grid-cols-[minmax(220px,0.9fr)_minmax(250px,1.1fr)] xl:gap-6 xl:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-h-0 flex-col items-center justify-center">
            <div className="relative flex now-disc items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.9),rgba(0,0,0,0.08))] shadow-[0_24px_50px_-22px_rgba(0,0,0,0.45)]" />
              <div className="absolute inset-[7%] rounded-full border border-white/50 bg-[conic-gradient(from_0deg,rgba(0,0,0,0.10),rgba(0,0,0,0.03),rgba(0,0,0,0.12),rgba(0,0,0,0.03),rgba(0,0,0,0.10))]" />
              <div className="absolute inset-[13%] rounded-full bg-[repeating-radial-gradient(circle,rgba(0,0,0,0.18),rgba(0,0,0,0.18)_1px,transparent_1px,transparent_5px)] opacity-40" />
              <div
                data-disc-spinning={discSpinning}
                className={cn(
                  'relative h-[62%] w-[62%] overflow-hidden rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.35)] disc-spin',
                  !discSpinning && 'disc-paused',
                )}
              >
                <ImageWithFallback
                  src={currentSong.al.picUrl}
                  alt={currentSong.name}
                  rounded="rounded-full"
                  className="h-full w-full"
                />
                <div className="absolute inset-0 rounded-full border border-white/15" />
                <div className="disc-spindle absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-inner" />
              </div>
            </div>

            <div className="mt-5 max-w-[360px] text-center">
              <h2 className="headline-lg truncate text-[24px]">{currentSong.name}</h2>
              {currentSong.alia?.[0] ? (
                <p className="mt-1 truncate text-[12px] text-black/35">{currentSong.alia[0]}</p>
              ) : null}
              <p className="mt-2 text-[13px] text-black/45">
                <ArtistLinks artists={currentSong.ar} />
                <span className="mx-2 text-black/20">·</span>
                {currentSong.al.name}
              </p>
              {busy ? (
                <p
                  className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-[#0066cc]"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {loadingSource ? '正在加载音源…' : '正在缓冲…'}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-6">
              <button
                type="button"
                aria-label="上一首"
                onClick={() => void prev()}
                className="pressable text-black/55 hover:text-black"
              >
                <SkipBack className="h-5 w-5 fill-current" />
              </button>
              <button
                type="button"
                aria-label={
                  loadingSource ? '正在加载音源' : buffering ? '正在缓冲' : playing ? '暂停' : '播放'
                }
                onClick={() => void togglePlay()}
                className="pressable flex h-12 w-12 items-center justify-center rounded-full bg-[#0066cc] text-white shadow-[0_6px_18px_rgba(0,102,204,0.35)] hover:bg-[#0071e3]"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : playing ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="ml-[2px] h-5 w-5 fill-current" />
                )}
              </button>
              <button
                type="button"
                aria-label="下一首"
                onClick={() => void next()}
                className="pressable text-black/55 hover:text-black"
              >
                <SkipForward className="h-5 w-5 fill-current" />
              </button>
            </div>
          </div>

          <div
            className={cn(
              'relative hidden min-h-0 flex-col rounded-[22px] md:flex',
              panel === 'comments' && 'border border-white/60 bg-white/45 backdrop-blur-xl',
            )}
          >
            <div className="flex flex-none items-center gap-1 px-3 py-2">
              <button
                type="button"
                onClick={() => setPanel('lyrics')}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] transition-colors',
                  panel === 'lyrics'
                    ? 'bg-white/80 font-medium text-[#0066cc]'
                    : 'text-black/40 hover:text-black/65',
                )}
              >
                歌词
              </button>
              <button
                type="button"
                onClick={() => setPanel('comments')}
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-[11px] transition-colors',
                  panel === 'comments'
                    ? 'bg-white/80 font-medium text-[#0066cc]'
                    : 'text-black/40 hover:text-black/65',
                )}
              >
                <MessageSquareText className="h-3 w-3" />
                评论
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              {panel === 'lyrics' ? (
                lyricLoading && !lyricLines.length ? (
                  <div
                    className="flex h-full flex-col items-center justify-center gap-2.5 text-[12px] text-black/35"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-[#0066cc]" />
                    正在加载歌词…
                  </div>
                ) : (
                  <LyricsPanel
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    currentTimeMs={currentTime * 1000}
                    onSeek={handleSeek}
                    className="h-full"
                  />
                )
              ) : (
                <div className="h-full overflow-y-auto px-5 pb-8 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
