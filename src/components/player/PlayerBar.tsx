import { useEffect, useRef } from 'react'
import {
  ChevronUp,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { ProgressSlider } from './ProgressSlider'
import { VolumeSlider } from './VolumeSlider'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { formatDuration } from '../../lib/format'
import { registerAudio, setAudioVolume } from '../../lib/audio'
import { cacheSong } from '../../lib/songCache'
import { cn } from '../../lib/format'

export function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const retriedRef = useRef<number | null>(null)
  const lastPlayTokenRef = useRef<number | null>(null)
  const switchingRef = useRef(false)

  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const mode = usePlayerStore((state) => state.mode)
  const volume = usePlayerStore((state) => state.volume)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const buffered = usePlayerStore((state) => state.buffered)
  const playToken = usePlayerStore((state) => state.playToken)
  const audioUrl = usePlayerStore((state) => state.audioUrl)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const heartMode = usePlayerStore((state) => state.heartMode)
  const heartLoading = usePlayerStore((state) => state.heartLoading)

  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleMode = usePlayerStore((state) => state.cycleMode)
  const toggleHeartMode = usePlayerStore((state) => state.toggleHeartMode)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const setBuffered = usePlayerStore((state) => state.setBuffered)
  const setAudioReady = usePlayerStore((state) => state.setAudioReady)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)

  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const liked = currentSong ? likedIds.includes(currentSong.id) : false

  useEffect(() => {
    registerAudio(audioRef.current)
    return () => registerAudio(null)
  }, [])

  // Blob URLs created for cached tracks are owned by the audio element while
  // it is mounted; release the last one when the player unmounts.
  useEffect(() => {
    return () => {
      const src = audioRef.current?.getAttribute('src')
      if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
    }
  }, [])

  useEffect(() => {
    setAudioVolume(volume)
  }, [volume])

  // Every play request (previous / next / pick a song / replay) bumps
  // playToken. Reset the old audio and progress before the next track loads.
  useEffect(() => {
    if (lastPlayTokenRef.current === playToken) return
    lastPlayTokenRef.current = playToken
    const audio = audioRef.current
    if (!audio) return
    switchingRef.current = true
    audio.pause()
    audio.currentTime = 0
    setCurrentTime(0)
    setBuffered(0)
    setAudioReady(false)

    // Replaying the same source needs a manual restart; a different source
    // is loaded by the url effect below.
    if (audioUrl && audio.getAttribute('src') === audioUrl) {
      switchingRef.current = false
      if (usePlayerStore.getState().playing) {
        void audio.play().catch(() => undefined)
      }
    }
  }, [playToken, audioUrl, setAudioReady, setBuffered, setCurrentTime])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    if (audio.getAttribute('src') !== audioUrl) {
      const previousSrc = audio.getAttribute('src')
      switchingRef.current = true
      audio.pause()
      audio.currentTime = 0
      setCurrentTime(0)
      setBuffered(0)
      setAudioReady(false)
      audio.src = audioUrl
      audio.load()
      retriedRef.current = null
      if (previousSrc?.startsWith('blob:')) URL.revokeObjectURL(previousSrc)
    }
    if (usePlayerStore.getState().playing) {
      void audio.play().catch(() => undefined)
    }
  }, [audioUrl, setAudioReady, setBuffered, setCurrentTime])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      const currentSrc = audio.getAttribute('src')
      if (sourceReady && audioUrl && currentSrc === audioUrl && audio.paused) {
        void audio.play().catch(() => undefined)
      }
    } else if (!audio.paused) {
      audio.pause()
    }
  }, [playing, sourceReady, audioUrl])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      void togglePlay()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [togglePlay])

  if (!queue.length || !currentSong) {
    return (
      <div className="player-glass flex h-[76px] items-center justify-center text-[12px] text-black/35">
        选择一首歌曲开始播放
      </div>
    )
  }

  const duration = currentSong.dt || 0
  const percent = duration ? Math.min(100, (currentTime * 1000 * 100) / duration) : 0
  // While the audio element still points at the previous track, force the
  // progress UI to zero so stale timeupdate events can never leak through.
  const sourceMatches =
    Boolean(audioUrl) && audioRef.current?.getAttribute('src') === audioUrl
  const displayTime = sourceMatches ? currentTime : 0
  const displayPercent = sourceMatches ? percent : 0
  const displayBuffered = sourceMatches ? buffered : 0

  const handleSeek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !duration || !sourceMatches) return
    const seconds = (value / 100) * (duration / 1000)
    audio.currentTime = seconds
    setCurrentTime(seconds)
  }

  const updateBuffered = () => {
    if (switchingRef.current) return
    const audio = audioRef.current
    if (!audio) return
    const ranges = audio.buffered
    if (!ranges.length || !audio.duration) return
    setBuffered((ranges.end(ranges.length - 1) / audio.duration) * 100)
  }

  const modeIcon =
    mode === 'random' ? (
      <Shuffle className="h-[15px] w-[15px]" />
    ) : mode === 'singleLoop' ? (
      <Repeat1 className="h-[15px] w-[15px]" />
    ) : (
      <Repeat className="h-[15px] w-[15px]" />
    )

  return (
    <div className="player-glass relative z-30 grid h-[76px] grid-cols-[minmax(170px,1fr)_minmax(300px,1.5fr)_minmax(150px,1fr)] items-center gap-4 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => toggleNowPlaying()}
          className="group pressable relative shrink-0"
          title={showNowPlaying ? '收起播放页' : '打开播放页'}
        >
          <ImageWithFallback
            src={currentSong.al.picUrl}
            alt={currentSong.name}
            rounded="rounded-[8px]"
            className="h-[46px] w-[46px]"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <ChevronUp className="h-5 w-5" />
          </span>
        </button>

        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => toggleNowPlaying()}
          title={showNowPlaying ? '收起播放页' : '打开播放页'}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[12.5px] font-medium text-black/80 hover:text-[#0066cc]">
              {currentSong.name}
            </span>
            <button
              type="button"
              aria-label={liked ? '取消喜欢' : '喜欢'}
              onClick={(event) => {
                event.stopPropagation()
                void likeSong(currentSong.id, !liked)
              }}
              className="pressable shrink-0"
            >
              <Heart
                className={cn(
                  'h-[13px] w-[13px] transition-colors',
                  liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-black/30 hover:text-black/60',
                )}
              />
            </button>
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-black/40">
            <ArtistLinks artists={currentSong.ar} />
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div className="flex items-center gap-5">
          <button
            type="button"
            title={heartMode ? '关闭心动模式' : '心动模式'}
            aria-label="心动模式"
            aria-pressed={heartMode}
            disabled={heartLoading}
            onClick={() => void toggleHeartMode()}
            className={cn(
              'pressable transition-colors disabled:opacity-50',
              heartMode ? 'text-[#ff2d55]' : 'text-black/35 hover:text-black/70',
            )}
          >
            {heartLoading ? (
              <Loader2 className="h-[15px] w-[15px] animate-spin" />
            ) : (
              <Sparkles className="h-[15px] w-[15px]" />
            )}
          </button>
          <button
            type="button"
            title={
              mode === 'order' ? '顺序播放' : mode === 'random' ? '随机播放' : '单曲循环'
            }
            onClick={cycleMode}
            className={cn(
              'pressable transition-colors',
              mode === 'order' ? 'text-black/35 hover:text-black/70' : 'text-[#0066cc]',
            )}
          >
            {modeIcon}
          </button>
          <button
            type="button"
            aria-label="上一首"
            onClick={() => void prev()}
            className="pressable text-black/65 hover:text-black"
          >
            <SkipBack className="h-[17px] w-[17px] fill-current" />
          </button>
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            onClick={() => void togglePlay()}
            className="pressable flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#0066cc] text-white shadow-[0_2px_8px_rgba(0,102,204,0.35)] hover:bg-[#0071e3]"
          >
            {playing ? (
              <Pause className="h-[15px] w-[15px] fill-current" />
            ) : (
              <Play className="ml-[1px] h-[15px] w-[15px] fill-current" />
            )}
          </button>
          <button
            type="button"
            aria-label="下一首"
            onClick={() => void next()}
            className="pressable text-black/65 hover:text-black"
          >
            <SkipForward className="h-[17px] w-[17px] fill-current" />
          </button>
          <button
            type="button"
            onClick={() => toggleQueue()}
            className="pressable text-black/35 transition-colors hover:text-black/70"
            title="播放列表"
          >
            <ListMusic className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="mt-1.5 flex w-full items-center gap-2.5">
          <span
            data-testid="elapsed-time"
            className="w-9 shrink-0 text-right text-[10px] tabular-nums text-black/35"
          >
            {formatDuration(displayTime * 1000)}
          </span>
          <ProgressSlider
            key={`${currentSong.id}-${playToken}`}
            value={displayPercent}
            buffered={displayBuffered}
            onChange={handleSeek}
          />
          <span className="w-9 shrink-0 text-[10px] tabular-nums text-black/35">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black/75"
              aria-label="音量"
            >
              {volume === 0 ? (
                <VolumeX className="h-[15px] w-[15px]" />
              ) : volume < 45 ? (
                <Volume1 className="h-[15px] w-[15px]" />
              ) : (
                <Volume2 className="h-[15px] w-[15px]" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={10}
            glass
            className="w-[52px] px-0 py-3"
          >
            <div className="flex flex-col items-center gap-2">
              <VolumeSlider value={volume} onChange={setVolume} />
              <span className="text-[10px] tabular-nums text-black/35">{volume}</span>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => toggleNowPlaying()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black/75"
          aria-label="展开播放页"
        >
          <ChevronUp className="h-[16px] w-[16px]" />
        </button>
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        onLoadedData={() => {
          const audio = audioRef.current
          if (audio && audioUrl && audio.getAttribute('src') === audioUrl) {
            switchingRef.current = false
            setAudioReady(true)
            if (!audioUrl.startsWith('blob:') && currentSong?.url) {
              cacheSong({
                id: currentSong.id,
                name: currentSong.name,
                url: currentSong.url,
              })
            }
          }
        }}
        onCanPlay={() => {
          const audio = audioRef.current
          if (!audio || !audioUrl) return
          if (audio.getAttribute('src') !== audioUrl) return
          switchingRef.current = false
          setAudioReady(true)
          if (usePlayerStore.getState().playing && audio.paused) {
            void audio.play().catch(() => undefined)
          }
        }}
        onPlaying={() => {
          const audio = audioRef.current
          if (audio && audioUrl && audio.getAttribute('src') === audioUrl) {
            switchingRef.current = false
            setAudioReady(true)
          }
        }}
        onPause={() => {
          setAudioReady(false)
        }}
        onWaiting={() => {
          setAudioReady(false)
        }}
        onStalled={() => {
          setAudioReady(false)
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget
          if (switchingRef.current) return
          if (audioUrl && audio.getAttribute('src') !== audioUrl) return
          setCurrentTime(audio.currentTime)
          updateBuffered()
        }}
        onProgress={updateBuffered}
        onEnded={() => {
          if (mode === 'singleLoop') {
            const audio = audioRef.current
            if (audio) {
              setCurrentTime(0)
              audio.currentTime = 0
              void audio.play().catch(() => undefined)
            }
          } else {
            void next()
          }
        }}
        onError={() => {
          setAudioReady(false)
          if (!audioUrl) return
          if (retriedRef.current === currentSong.id) {
            void next()
            return
          }
          retriedRef.current = currentSong.id
          void refreshCurrentUrl()
        }}
      />
    </div>
  )
}
