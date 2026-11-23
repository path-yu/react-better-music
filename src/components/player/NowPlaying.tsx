import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  Disc3,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  LocateFixed,
  Search,
  X,
} from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import {
  cachePlayerMenuTint,
  menuSurfaceStyle,
} from '../../lib/menuSurface'
import { LyricsPanel } from './LyricsPanel'
import { LyricStage } from './LyricStage'
import { SimilarSongsPanel } from './SimilarSongsPanel'
import AmbientBackground from './AmbientBackground'
import { FogBackground } from './FogBackground'
import { AppleBackdrop } from './AppleBackdrop'
import { MvVideoPlayer } from '../mv/MvVideoPlayer'
import { PlayerArtwork } from './PlayerArtwork'
import { ImmersivePlayerBar } from './ImmersivePlayerBar'
import { NowPlayingTitleBar } from './NowPlayingTitleBar'
import { NowPlayingTransport } from './NowPlayingTransport'
import { stepTab, useSwipeNavigation } from '../../lib/useSwipeNavigation'
import { useScrollEdgeHints } from '../../lib/useScrollEdgeHints'
import { CommentSection, useCommentTotal } from '../comments/CommentSection'
import { SongContextMenu } from '../songs/SongContextMenu'
import { fetchMvUrl, fetchRelatedVideos, fetchSongDetail } from '../../api'
import { useDelayedBusy } from '../../lib/useDelayedBusy'
import { isDesktopShell } from '../../lib/desktop'
import { isTauriApp } from '../../lib/platform'
import { selectOverlayTime, usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import { useSettingsStore, type PlayerStyle } from '../../store/settings'
import { findLyricIndex } from '../../lib/lyric'
import { seekAudio } from '../../lib/audio'
import {
  FALLBACK_PALETTE,
  extractPalette,
  hexToRgb,
  withAlpha,
  type Palette,
} from '../../lib/color'
import { resizedImageUrl } from '../../lib/image'
import { toast } from '../../lib/toast'
import { cn, formatDuration, matchesKeyword } from '../../lib/format'
import type { Song } from '../../types'

type NowPlayingPanel =
  | 'lyrics'
  | 'stage'
  | 'queue'
  | 'comments'
  | 'related'
type QueueView = 'list' | 'grid'
/** Mobile tab order, left to right; "song" is the cover view. */
const MOBILE_VIEWS = ['song', 'lyrics', 'stage', 'queue', 'comments', 'related'] as const
type MobileView = (typeof MOBILE_VIEWS)[number]
const MOBILE_QUERY = '(max-width: 767.98px)'

type ArtSnapshot = {
  song: Song
  style: PlayerStyle
  playing: boolean
  position: number
  liked: boolean
  albumAvailable: boolean
  glowRgb?: string
}

function formatCommentCount(value: number, locale: string) {
  if (value < 1000) return String(value)
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

const SONG_TILE_MIN = 112
const SONG_TILE_GAP = 14

/** The player-bar cover and Now Playing share the same window coordinate space. */
function coverInset(source: Element, overlay: HTMLElement, radius: number) {
  const from = source.getBoundingClientRect()
  const area = overlay.getBoundingClientRect()
  return [
    from.top - area.top,
    area.right - from.right,
    area.bottom - from.bottom,
    from.left - area.left,
  ].map((value) => `${Math.max(0, value)}px`).join(' ') +
    ` round ${radius}px`
}

export function NowPlaying() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const show = usePlayerStore((state) => state.showNowPlaying)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const lastStepDirection = usePlayerStore(
    (state) => state.lastStepDirection,
  )
  const currentSong = queue[currentIndex]
  // Backdrop follows the current cover; the colour wash is sampled from it.
  const artwork = currentSong?.al.picUrl
  const playing = usePlayerStore((state) => state.playing)
  const audioReady = usePlayerStore((state) => state.audioReady)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const busyVisible = useDelayedBusy(
    playing && (!sourceReady || !audioReady),
  )
  // Playback progress changes ~4 times per second. This 1900-line overlay only
  // needs the lyric line index; the artwork and word-by-word stage subscribe to
  // the position themselves (see LivePlayerArtwork / LiveLyricStage below).
  const activeIndex = usePlayerStore((state) =>
    findLyricIndex(state.lyricLines, selectOverlayTime(state) * 1000),
  )
  const sourceTransition = usePlayerStore((state) => state.sourceTransition)
  const holdArtworkPosition = sourceTransition === 'stem'
  const lyricLines = usePlayerStore((state) => state.lyricLines)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
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
  const toggleLike = () => {
    if (!currentSong) return
    if (isLogin) void likeSong(currentSong.id, !liked)
    else void toggleLocalFavorite(currentSong)
  }
  const bindVideo = useVideoPlaybackStore((state) => state.bind)
  const videoActive = useVideoPlaybackStore((state) => state.active)
  const nowPlayingMode = useSettingsStore((state) => state.nowPlayingMode)
  const playerStyle = useSettingsStore((state) => state.playerStyle)
  const setNowPlayingMode = useSettingsStore(
    (state) => state.setNowPlayingMode,
  )
  const backdropStyle = useSettingsStore((state) => state.backdropStyle)
  const nowPlayingTransition = useSettingsStore(
    (state) => state.nowPlayingTransition,
  )
  const growFromCover = nowPlayingTransition === 'cover'
  const [panel, setPanel] = useState<NowPlayingPanel>('lyrics')
  const [tabsVisible, setTabsVisible] = useState(true)
  /** Mobile only: the cover view ("歌曲" tab) instead of one of the panels. */
  const [mobileSongView, setMobileSongView] = useState(true)
  const [swipeArea, setSwipeArea] = useState<HTMLDivElement | null>(null)
  const [mobileTabList, setMobileTabList] = useState<HTMLDivElement | null>(null)
  const [outgoingArt, setOutgoingArt] = useState<{
    snapshot: ArtSnapshot
    direction: number
  } | null>(null)
  const [artDirection, setArtDirection] = useState<number | null>(null)
  const artSnapshotRef = useRef<ArtSnapshot | null>(null)
  const lastArtSongRef = useRef(currentSong?.id)
  const artExitTimerRef = useRef(0)
  const [queueContext, setQueueContext] = useState<{
    song: Song
    x: number
    y: number
  } | null>(null)
  const queueScrollRef = useRef<HTMLDivElement>(null)
  const queueListRef = useRef<HTMLDivElement>(null)
  const queueLocateTimerRef = useRef<number | null>(null)
  const [showQueueLocate, setShowQueueLocate] = useState(false)
  const [queueWidth, setQueueWidth] = useState(0)
  const [queueView, setQueueView] = useState<QueueView>('list')
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
  const mvUrlCacheRef = useRef<{
    songId: number
    videoId: number
    url: string
    at: number
  } | null>(null)
  // Some songs carry no `mv` field, or only a related video. Search determines
  // whether the result is a real official MV or merely an adjacent video.
  const videoCacheRef = useRef(
    new Map<number, { id: number; official: boolean } | null>(),
  )
  const [resolvedVideo, setResolvedVideo] = useState<{
    songId: number
    id: number
    official: boolean
  } | null>(null)
  const [videoLookup, setVideoLookup] = useState<{
    songId: number
    done: boolean
  }>({ songId: 0, done: false })
  const overlayRef = useRef<HTMLDivElement>(null)
  const exitTimerRef = useRef<number | null>(null)
  const exitCleanupRef = useRef<(() => void) | null>(null)
  const coverMorphCleanupRef = useRef<(() => void) | null>(null)
  const artworkRef = useRef(artwork)
  artworkRef.current = artwork
  const exitingRef = useRef(false)
  const albumResolveRef = useRef(false)
  const requestClose = useCallback(() => {
    if (exitingRef.current) return
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const durations = {
      fade: 240,
      'slide-up': 360,
      scale: 280,
      cover: 360,
      none: 0,
    }
    const duration = reduced
      ? 0
      : growFromCover
        ? 360
        : durations[nowPlayingTransition]
    const overlay = overlayRef.current
    if (!duration || !overlay) {
      toggleNowPlaying(false)
      return
    }

    if (growFromCover) {
      const source = document.querySelector<HTMLElement>('[data-player-cover]')
      if (!source) {
        toggleNowPlaying(false)
        return
      }
      coverMorphCleanupRef.current?.()
      coverMorphCleanupRef.current = null
      exitingRef.current = true
      overlay.classList.remove(
        'np-enter-fade',
        'np-enter-slide-up',
        'np-enter-scale',
      )
      overlay.style.transition = 'none'
      overlay.style.clipPath = ''
      overlay.style.opacity = ''
      overlay.getBoundingClientRect()
      const toCover = `inset(${coverInset(source, overlay, 10)})`
      const animation = overlay.animate(
        [
          { clipPath: 'inset(0 0 0 0 round 18px)', opacity: 1 },
          { clipPath: toCover, opacity: 0.88 },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'both',
        },
      )
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        animation.cancel()
        exitCleanupRef.current?.()
        exitCleanupRef.current = null
        exitingRef.current = false
        toggleNowPlaying(false)
      }
      animation.addEventListener('finish', finish)
      exitTimerRef.current = window.setTimeout(finish, duration + 150)
      exitCleanupRef.current = () => {
        animation.removeEventListener('finish', finish)
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current)
          exitTimerRef.current = null
        }
      }
      return
    }

    // Apply the exit directly to the DOM instead of changing React state. A
    // state update re-renders the whole lyrics/artwork tree and can block the
    // first frames, which previously made the close look instantaneous.
    exitingRef.current = true
    // A filled entrance animation would otherwise keep overriding the inline
    // exit transition (animations outrank transitions in the cascade).
    overlay.classList.remove(
      'np-enter-fade',
      'np-enter-slide-up',
      'np-enter-scale',
    )
    const easing = 'cubic-bezier(0.4, 0, 1, 1)'
    overlay.style.transition =
      nowPlayingTransition === 'fade'
        ? `opacity ${duration}ms ease`
        : nowPlayingTransition === 'scale'
          ? `transform ${duration}ms ${easing}, opacity ${duration}ms ease`
          : `transform ${duration}ms ${easing}`

    // Establish the starting style, flush it, then assign the exit target.
    if (nowPlayingTransition !== 'fade') {
      overlay.style.transform = 'translateY(0) scale(1)'
    }
    overlay.style.opacity = '1'
    overlay.getBoundingClientRect()

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      exitCleanupRef.current?.()
      exitCleanupRef.current = null
      exitingRef.current = false
      toggleNowPlaying(false)
    }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === overlay) finish()
    }
    overlay.addEventListener('transitionend', onTransitionEnd)
    // The transition itself decides when the close is safe. A fallback covers
    // a frame stall where transitionend never arrives.
    exitTimerRef.current = window.setTimeout(finish, duration + 150)
    exitCleanupRef.current = () => {
      overlay.removeEventListener('transitionend', onTransitionEnd)
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }

    if (nowPlayingTransition === 'slide-up') {
      overlay.style.transform = 'translateY(100%)'
    } else if (nowPlayingTransition === 'fade') {
      overlay.style.opacity = '0'
    } else {
      overlay.style.transform = 'scale(0.965)'
      overlay.style.opacity = '0'
    }
  }, [growFromCover, nowPlayingTransition, toggleNowPlaying])

  useEffect(() => {
    return () => {
      exitCleanupRef.current?.()
      exitCleanupRef.current = null
      coverMorphCleanupRef.current?.()
      coverMorphCleanupRef.current = null
      exitingRef.current = false
    }
  }, [])

  useLayoutEffect(() => {
    coverMorphCleanupRef.current?.()
    coverMorphCleanupRef.current = null
    if (show) {
      exitCleanupRef.current?.()
      exitCleanupRef.current = null
      exitingRef.current = false
    }
    const overlay = overlayRef.current
    if (!overlay) return
    // The close animation is written imperatively so it can start immediately.
    // Always clear those inline styles once the page is closed (and whenever
    // the transition mode changes), otherwise the next open/close would reuse
    // the previous mode's transform/transition for one cycle.
    overlay.style.transition = ''
    overlay.style.transform = ''
    overlay.style.opacity = ''
    overlay.style.clipPath = ''

    if (!show || !growFromCover) return
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reduced) return
    const source = document.querySelector<HTMLElement>('[data-player-cover]')
    const target = overlay.querySelector<HTMLElement>(
      '[data-now-playing-art] .now-disc',
    )
    if (!source || !target) return

    const area = overlay.getBoundingClientRect()
    const from = source.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    const startClip = `inset(${coverInset(source, overlay, 10)})`
    const endClip = 'inset(0 0 0 0 round 18px)'
    const local = (rect: DOMRect) => ({
      left: `${rect.left - area.left}px`,
      top: `${rect.top - area.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })

    overlay.style.transition = 'none'
    const ghost = document.createElement('div')
    Object.assign(ghost.style, {
      position: 'absolute',
      zIndex: '60',
      overflow: 'hidden',
      pointerEvents: 'none',
      borderRadius: '10px',
      backgroundColor: '#16161a',
      backgroundImage: artworkRef.current
        ? `url("${artworkRef.current}")`
        : '',
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      boxShadow: '0 18px 54px -16px rgba(0, 0, 0, 0.7)',
      ...local(from),
    })
    overlay.appendChild(ghost)

    const grow = overlay.animate(
      [
        { clipPath: startClip, opacity: 0.94 },
        { clipPath: endClip, opacity: 1 },
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    )
    const ghostMove = ghost.animate(
      [
        { ...local(from), borderRadius: '10px', opacity: 1 },
        { ...local(to), borderRadius: '18px', opacity: 1, offset: 0.78 },
        { ...local(to), borderRadius: '18px', opacity: 0 },
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    )
    let finished = false
    let fallback = 0
    const cleanup = () => {
      grow.cancel()
      ghostMove.cancel()
      ghost.remove()
      window.clearTimeout(fallback)
      overlay.style.clipPath = ''
      overlay.style.opacity = ''
      overlay.style.transition = ''
    }
    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      coverMorphCleanupRef.current = null
    }
    grow.addEventListener('finish', finish)
    fallback = window.setTimeout(finish, 650)
    coverMorphCleanupRef.current = () => {
      finished = true
      cleanup()
    }
  }, [growFromCover, nowPlayingTransition, show])

  const rawMvId = currentSong?.mv ?? currentSong?.mvid
  // `mv: 0` is a valid "no MV" marker, not a nullish value.
  const mvId = rawMvId && Number(rawMvId) > 0 ? rawMvId : undefined
  const resolvedVideoForSong =
    currentSong && resolvedVideo?.songId === currentSong.id
      ? resolvedVideo
      : null
  // Do not render an optimistic 视频 badge and then swap it to MV when the
  // official match arrives. The button only appears after the lookup settles.
  const videoLookupDone = Boolean(
    currentSong &&
      videoLookup.songId === currentSong.id &&
      videoLookup.done,
  )
  const activeVideo = videoLookupDone
    ? (resolvedVideoForSong ??
      (mvId ? { id: Number(mvId), official: false } : null))
    : null
  const hasMv = Boolean(activeVideo?.id)
  const videoBadgeLabel = activeVideo?.official
    ? 'MV'
    : i18n._(msg`视频`)
  // The CDN URLs returned by the API are HTTP; WebView2 rejects them as mixed
  // content. Normalise to a secure, smaller copy before colour sampling.
  const ambientSource = useMemo(
    () => resizedImageUrl(artwork, '640y640') ?? artwork,
    [artwork],
  )
  // Apple feeds its scene a 316px cover; it is blurred past recognition, so a
  // small file keeps texture uploads cheap.
  const appleBackdropSource = useMemo(
    () => resizedImageUrl(artwork, '320y320') ?? artwork,
    [artwork],
  )

  // Measure the grid once before laying out rows. Only visible rows are mounted
  // below, so a 1000+ song queue does not create thousands of covers.
  useEffect(() => {
    if (panel !== 'queue' || queueView !== 'grid') return
    const element = queueScrollRef.current
    if (!element) return
    const updateWidth = () => setQueueWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panel, queueView])

  const queueInnerWidth = Math.max(0, queueWidth - 16)
  const queueColumns = Math.max(
    1,
    Math.floor((queueInnerWidth + SONG_TILE_GAP) / (SONG_TILE_MIN + SONG_TILE_GAP)),
  )
  // Stretch the covers so the columns span the whole row: fixed 112px tiles
  // sat flush left and left up to one tile of empty space on the right
  // (~100px in a 490px window). Columns are still chosen from the 112px
  // minimum, so a tile grows by less than one pitch; the few pixels the
  // floor() leaves over are split on both sides.
  const queueTileWidth = Math.max(
    1,
    Math.min(
      queueInnerWidth,
      Math.floor(
        (queueInnerWidth - SONG_TILE_GAP * (queueColumns - 1)) / queueColumns,
      ),
    ),
  )
  const queueRowOffset = Math.max(
    0,
    Math.floor(
      (queueInnerWidth -
        queueColumns * queueTileWidth -
        SONG_TILE_GAP * (queueColumns - 1)) /
        2,
    ),
  )
  const queueRowHeight = Math.max(80, queueTileWidth + SONG_TILE_GAP)
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
  const queueRowCount = Math.ceil(queueEntries.length / queueColumns)
  const queueVirtualizer = useVirtualizer({
    count:
      panel === 'queue' && queueView === 'grid' && queueWidth > 0
        ? queueRowCount
        : 0,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => queueRowHeight,
    overscan: 4,
  })
  const queueListVirtualizer = useVirtualizer({
    count:
      panel === 'queue' && queueView === 'list' ? queueEntries.length : 0,
    getScrollElement: () => queueListRef.current,
    estimateSize: () => 58,
    overscan: 8,
  })

  useEffect(() => {
    setShowQueueLocate(false)
    if (!show || panel !== 'queue' || queueView !== 'list') return
    const target = queueListRef.current
    if (!target) return
    const reveal = () => {
      setShowQueueLocate(true)
      if (queueLocateTimerRef.current !== null) {
        window.clearTimeout(queueLocateTimerRef.current)
      }
      queueLocateTimerRef.current = window.setTimeout(() => {
        setShowQueueLocate(false)
        queueLocateTimerRef.current = null
      }, 2000)
    }
    target.addEventListener('scroll', reveal, { passive: true })
    return () => {
      target.removeEventListener('scroll', reveal)
      if (queueLocateTimerRef.current !== null) {
        window.clearTimeout(queueLocateTimerRef.current)
        queueLocateTimerRef.current = null
      }
    }
  }, [panel, queue.length, queueView, show])

  const measureQueue = queueVirtualizer.measure
  useEffect(() => {
    if (panel !== 'queue' || queueView !== 'grid') return
    measureQueue()
  }, [panel, queueView, queueColumns, queueRowHeight, measureQueue])



  // On desktop, the reference fades the pane tabs out when the pointer leaves
  // the window and back in when it returns. Only do this for the actual window
  // shells; a normal browser tab should keep the controls visible.
  useEffect(() => {
    const desktop = isDesktopShell() || isTauriApp()
    if (!desktop || !show) {
      setTabsVisible(true)
      return
    }
    const root = document.documentElement
    const revealTabs = () => setTabsVisible(true)
    const hideTabs = () => setTabsVisible(false)
    setTabsVisible(root.matches(':hover'))
    root.addEventListener('pointerenter', revealTabs)
    root.addEventListener('pointerleave', hideTabs)
    window.addEventListener('blur', hideTabs)
    return () => {
      root.removeEventListener('pointerenter', revealTabs)
      root.removeEventListener('pointerleave', hideTabs)
      window.removeEventListener('blur', hideTabs)
    }
  }, [show])

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
    // Keep the active pane when the track changes. In particular, comments
    // must not be unmounted just because the user pressed next/previous.
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

  // Resolve official-vs-related once per song. Exact title/artist matches are
  // labelled MV; everything else gets the generic 视频 label.
  useEffect(() => {
    if (!show || !currentSong) return
    const song = currentSong
    const cached = videoCacheRef.current.get(song.id)
    if (cached !== undefined) {
      setResolvedVideo(cached ? { songId: song.id, ...cached } : null)
      setVideoLookup({ songId: song.id, done: true })
      return
    }
    setVideoLookup({ songId: song.id, done: false })
    let active = true
    void fetchRelatedVideos(song, 8)
      .then((videos) => {
        const mv = videos.find((video) => video.kind === 'mv')
        let next: { id: number; official: boolean } | null = null
        if (mv) {
          const id = Number(mv.id)
          if (Number.isFinite(id)) {
            next = { id, official: Boolean(mv.official) }
          }
        }
        if (!next && mvId) {
          next = { id: Number(mvId), official: false }
        }
        videoCacheRef.current.set(song.id, next)
        if (active) {
          setResolvedVideo(next ? { songId: song.id, ...next } : null)
          setVideoLookup({ songId: song.id, done: true })
        }
      })
      .catch(() => {
        videoCacheRef.current.set(song.id, null)
        if (active) {
          setResolvedVideo(null)
          setVideoLookup({ songId: song.id, done: true })
        }
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
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // The queue panel is stacked above this view and handles Escape itself.
      if (usePlayerStore.getState().showQueue) return
      // So does an open menu or popover: Escape closes that first.
      if (document.querySelector('[role="menu"], [data-floating-content]')) return
      requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [show, requestClose])

  // Apple Music's lyrics screen is literally the artwork: the container carries
  // `background-image: url(cover)` + `background-color: var(--nowPlayingBackdropBG)`
  // and `.now-playing-structure` lays a `linear-gradient(0deg,#0006,#0000 50%)`
  // scrim on top. No white veil, no extra tints.

  // Stable identity keeps the memoised lyric list from re-rendering on every
  // playback tick. Must stay above the early return (rules of hooks).
  const handleSeek = useCallback((timeMs: number) => {
    seekAudio(timeMs / 1000)
  }, [])

  // Share the already-extracted artwork colour with menu/queue panels so they
  // can paint their first frame with the final tint.
  useEffect(() => {
    const cover = currentSong?.al.picUrl
    const tint = palette.colors[0]
    if (cover && tint) cachePlayerMenuTint(cover, tint)
  }, [currentSong?.al.picUrl, palette.colors])

  const artSnapshot: ArtSnapshot | null = currentSong
    ? {
        song: currentSong,
        style: playerStyle,
        playing,
        // Only read when the song changes (outgoing card), never reactively.
        position: selectOverlayTime(usePlayerStore.getState()),
        liked,
        albumAvailable: Boolean(currentSong.al.id),
        glowRgb: palette.colors[0]
          ? (() => {
              const { r, g, b } = hexToRgb(palette.colors[0])
              return `${r} ${g} ${b}`
            })()
          : undefined,
      }
    : null

  // Song changes slide the artwork horizontally, in the same direction as the
  // reference cover transition: next enters from the right, previous from the
  // left; the outgoing card leaves on the opposite side.
  useEffect(() => {
    if (!currentSong) return
    const previous = artSnapshotRef.current
    const previousId = lastArtSongRef.current
    if (
      show &&
      previous &&
      previousId !== undefined &&
      previousId !== currentSong.id
    ) {
      const direction = lastStepDirection
      setOutgoingArt({
        snapshot: previous,
        direction,
      })
      setArtDirection(direction)
      window.clearTimeout(artExitTimerRef.current)
      artExitTimerRef.current = window.setTimeout(() => {
        setOutgoingArt(null)
        setArtDirection(null)
      }, 540)
    }
    lastArtSongRef.current = currentSong.id
    artSnapshotRef.current = artSnapshot
  }, [currentSong?.id, currentIndex, lastStepDirection, queue.length, show])

  useEffect(
    () => () => window.clearTimeout(artExitTimerRef.current),
    [],
  )

  // Keep the overlay mounted so closing can play its exit animation. Video
  // mode already stays mounted to keep the decoder alive; audio mode remains
  // in the DOM but is hidden and non-interactive.
  // Mobile: the tab row can be wider than a 390px window; fade the edge that
  // still has tabs behind it.
  useScrollEdgeHints(mobileTabList)
  // Tapping / swiping to a half-hidden tab scrolls it fully into the row.
  useEffect(() => {
    if (!mobileTabList) return
    const active = mobileTabList.querySelector<HTMLElement>('.np-tab.is-active')
    if (!active) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const left = active.offsetLeft - mobileTabList.offsetLeft
    const target = Math.min(
      Math.max(left - 24, mobileTabList.scrollLeft),
      left + active.offsetWidth + 24 - mobileTabList.clientWidth,
    )
    if (Math.abs(target - mobileTabList.scrollLeft) < 1) return
    mobileTabList.scrollTo({ left: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' })
  }, [mobileTabList, panel, mobileSongView])

  // Mobile: swipe the middle area left / right to move between the top tabs.
  useSwipeNavigation(swipeArea, {
    enabled: () => window.matchMedia(MOBILE_QUERY).matches,
    onSwipe: (step) => {
      const current: MobileView = mobileSongView ? 'song' : panel
      const next = stepTab(MOBILE_VIEWS, current, step)
      if (next === current) return
      if (next === 'song') {
        setMobileSongView(true)
      } else {
        setPanel(next)
        setMobileSongView(false)
      }
      requestAnimationFrame(() => {
        const view = swipeArea?.querySelector<HTMLElement>(
          `[data-np-view="${next === 'song' ? 'song' : 'panel'}"]`,
        )
        if (!view || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        view.animate(
          [
            { transform: `translateX(${step * 28}px)`, opacity: 0.4 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
      })
    },
  })

  if (!currentSong) return null

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
  const albumAvailable = Boolean(albumId) || currentSong.id > 0
  const openAlbum = () => {
    if (!albumAvailable || albumResolveRef.current) return
    void (async () => {
      let resolvedId = albumId
      if (!resolvedId) {
        // Cached audio is rebuilt from the cache index, which only has the
        // song id/cover. Fetch the song once to recover its album id.
        albumResolveRef.current = true
        try {
          const detail = await fetchSongDetail(currentSong.id)
          resolvedId = detail?.al.id ?? 0
        } catch {
          resolvedId = 0
        } finally {
          albumResolveRef.current = false
        }
        if (!resolvedId) {
          toast.error(i18n._(msg`无法获取专辑信息`))
          return
        }
      }
      // Close first: the router may commit the album route only after its data
      // resolves, so relying on the pathname effect would leave this overlay on
      // top of the page the user just asked for (and it never fires when the
      // album is already the current path).
      toggleNowPlaying(false)
      void navigate({ to: '/albums/$id', params: { id: String(resolvedId) } })
    })()
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
    if (mvMode || !activeVideo) return
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
      cached.videoId === activeVideo.id &&
      Date.now() - cached.at < 10 * 60 * 1000
    ) {
      enterMvMode(cached.url)
      setMvLoading(false)
      return
    }

    try {
      const url = await fetchMvUrl(activeVideo.id)
      if (!url) throw new Error('empty mv url')
      mvUrlCacheRef.current = {
        songId: currentSong.id,
        videoId: activeVideo.id,
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

  // Song page tabs. Desktop shows them above the right column; mobile puts
  // them at the top of the page (with an extra "歌曲" tab for the cover view)
  // and shows one view at a time instead of one long scrolling page.
  const selectPanel = (next: NowPlayingPanel) => {
    setPanel(next)
    setMobileSongView(false)
  }
  const renderTabs = (mobile: boolean) => {
    const tabOn = (key: NowPlayingPanel) =>
      panel === key && !(mobile && mobileSongView)
    return (
      <div
        ref={mobile ? setMobileTabList : undefined}
        className={cn('np-tabs', mobile && 'np-tabs--mobile')}
        role="tablist"
        aria-label={i18n._(msg`歌词、律动、播放队列、评论与相似歌曲`)}
      >
        {mobile ? (
          <button
            type="button"
            role="tab"
            aria-selected={mobileSongView}
            onClick={() => setMobileSongView(true)}
            className={cn('np-tab', mobileSongView && 'is-active')}
          >
            <Trans>歌曲</Trans>
          </button>
        ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={tabOn('lyrics')}
        onClick={() => selectPanel('lyrics')}
        className={cn('np-tab', tabOn('lyrics') && 'is-active')}
      >
        <Trans>歌词</Trans>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tabOn('stage')}
        onClick={() => selectPanel('stage')}
        className={cn('np-tab', tabOn('stage') && 'is-active')}
      >
        <Trans>律动</Trans>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tabOn('queue')}
        onClick={() => selectPanel('queue')}
        className={cn('np-tab', tabOn('queue') && 'is-active')}
      >
        {mobile ? <Trans>队列</Trans> : <Trans>播放队列</Trans>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tabOn('comments')}
        onClick={() => selectPanel('comments')}
        className={cn('np-tab', tabOn('comments') && 'is-active')}
      >
        <Trans>评论</Trans>
        {commentTotal !== null ? (
          <span className="np-tab__count">
            {formatCommentCount(commentTotal, i18n.locale)}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tabOn('related')}
        onClick={() => selectPanel('related')}
        className={cn('np-tab', tabOn('related') && 'is-active')}
      >
        {mobile ? <Trans>相似</Trans> : <Trans>相似歌曲</Trans>}
      </button>
      </div>
    )
  }

  return (
    <div
      ref={overlayRef}
      inert={!show}
      className={cn(
        'nowplaying-overlay dark',
        // The closed geometry/fade lives in the transition classes; opening
        // uses an explicit keyframe animation so a newly selected mode cannot
        // inherit the previous mode's computed transform/opacity for a cycle.
        `np-transition-${nowPlayingTransition}`,
        show
          ? 'np-open'
          : 'np-closed np-closed-hidden pointer-events-none',
        show &&
          !growFromCover &&
          nowPlayingTransition !== 'none' &&
          `np-enter-${nowPlayingTransition}`,
      )}
      style={{ backgroundColor: 'var(--nowplaying-base, #0f0f12)' }}
      aria-hidden={!show}
    >
      {show ? <NowPlayingTitleBar /> : null}

      {/*
        Keep the WebGL canvas alive only while the detail page is actually
        visible. Keeping a full-screen WebGL context around for the whole
        session wastes GPU resources and makes a renderer/GPU crash more likely.
      */}
      {!show ? null : backdropStyle === 'apple' ? (
        <AppleBackdrop
          artwork={appleBackdropSource}
          playing={playing}
          fallback={
            <AmbientBackground
              artwork={ambientSource ?? ''}
              palette={palette}
              playing={playing}
            />
          }
        />
      ) : backdropStyle === 'fog' ? (
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
      <div
        className={cn(
          'relative flex h-full flex-col',
          videoActive ? 'pb-[76px]' : 'pb-4',
        )}
      >
        {/* Top chrome spacer: keeps the overlay content clear of the window
            title bar and of the fixed collapse button on mobile. The "like"
            control moved down to the transport row next to heart mode. */}
        <div
          className={cn(
            'flex h-[58px] flex-none items-center justify-between px-6',
            'max-md:items-start max-md:px-4 max-md:pt-4',
            mvMode && 'hidden',
          )}
        />

        {mvMode ? (
          <>
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
          </>
        ) : (
          <>
        <div className="flex flex-none justify-center px-4 pb-2 md:hidden">
          {renderTabs(true)}
        </div>
        {/* Desktop: two columns that own their scrolling (lyrics/comments), so
            the page itself never scrolls and the wheel target stays
            predictable. Mobile: one view at a time under the top tabs; the
            transport stays at the bottom of every panel. */}
        <div
          ref={setSwipeArea}
          className="grid flex-1 grid-cols-1 gap-4 px-6 max-md:flex max-md:min-h-0 max-md:touch-pan-y max-md:flex-col max-md:overflow-hidden max-md:px-4 md:grid-cols-[minmax(220px,0.9fr)_minmax(250px,1.1fr)] md:overflow-hidden xl:gap-6 xl:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            data-np-view="song"
            className={cn(
              'flex min-h-0 flex-col items-center justify-center',
              mobileSongView
                ? 'max-md:flex-1 max-md:overflow-y-auto'
                : 'max-md:order-2 max-md:flex-none max-md:pb-1',
            )}
          >
            <div
              className={cn(
                'max-w-[var(--np-art-size)] text-center',
                !mobileSongView && 'max-md:hidden',
              )}
            >
              <div className="flex min-w-0 items-center justify-center gap-1.5">
                <h2 className="headline-lg np-track-heading min-w-0 truncate">{currentSong.name}</h2>
                {currentSong.trialEnd ? (
                  <span className="shrink-0 rounded-[6px] bg-warn/12 px-1.5 py-0.5 text-[11px] font-semibold text-warn-ink">
                    <Trans>试听</Trans>
                  </span>
                ) : null}
                {hasMv ? (
                  <button
                    type="button"
                    aria-label={i18n._(msg`切换到视频播放`)}
                    title={i18n._(msg`切换到视频播放`)}
                    aria-pressed={mvMode}
                    onClick={() => void toggleMvMode()}
                    className="np-mv-badge  shrink-0 rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-accent transition-colors hover:bg-white/10"
                  >
                    {videoBadgeLabel}
                  </button>
                ) : null}
              </div>
              {currentSong.alia?.[0] ? (
                <p className="mt-1 truncate text-[12px] text-ink-4">{currentSong.alia[0]}</p>
              ) : null}
              {/* One line: a long album name used to wrap and leave the "·"
                  dangling after the artist on narrow windows. */}
              <p className="np-track-meta mt-2 flex min-w-0 items-center justify-center text-[13px] text-ink-3">
                <ArtistLinks artists={currentSong.ar} className="min-w-0 truncate" />
                {showAlbumMeta ? (
                  <>
                    <span className="mx-2 shrink-0 text-ink-4">·</span>
                    <button
                      type="button"
                      onClick={openAlbum}
                      disabled={!albumId}
                      title={currentSong.al.name}
                      className="pressable min-w-0 truncate rounded-[6px] underline-offset-2 transition-colors hover:text-white hover:underline disabled:cursor-default cursor-pointer"
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

            <div
              className={cn(
                'now-art-stage relative mt-6 mx-auto',
                !mobileSongView && 'max-md:hidden',
              )}
            >
              {outgoingArt ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    'now-art-layer now-art-layer--outgoing',
                    outgoingArt.direction > 0
                      ? 'is-exit-next'
                      : 'is-exit-prev',
                  )}
                >
                  <PlayerArtwork
                    {...outgoingArt.snapshot}
                    playing={false}
                    onOpenAlbum={() => undefined}
                    onToggleLike={() => undefined}
                  />
                </div>
              ) : null}
              <div
                key={currentSong.id}
                data-now-playing-art
                className={cn(
                  'now-art-layer',
                  artDirection === 1 && 'is-enter-next',
                  artDirection === -1 && 'is-enter-prev',
                )}
              >
                <LivePlayerArtwork
                  song={currentSong}
                  style={playerStyle}
                  playing={playing}
                  holdPosition={holdArtworkPosition}
                  liked={liked}
                  albumAvailable={albumAvailable}
                  glowRgb={
                    palette.colors[0]
                      ? (() => {
                          const { r, g, b } = hexToRgb(palette.colors[0])
                          return `${r} ${g} ${b}`
                        })()
                      : undefined
                  }
                  onOpenAlbum={openAlbum}
                  onToggleLike={toggleLike}
                />
              </div>
            </div>
            <div className={cn('np-transport-panel mt-5', !mobileSongView && 'max-md:mt-3')}>
              <NowPlayingTransport
                liked={liked}
                onToggleLike={toggleLike}
                onOpenRelatedVideos={() => void openRelatedVideos()}
                videoLoading={videoLoading}
              />
            </div>

          </div>
          <div
            data-np-view="panel"
            className={cn(
              'relative flex min-h-0 flex-col',
              mobileSongView ? 'max-md:hidden' : 'max-md:order-1 max-md:flex-1',
            )}
          >
            <div
              className={cn(
                'np-tabs-reveal flex flex-none items-center px-2 pb-1 pt-6 max-md:hidden',
                !tabsVisible && 'is-hidden',
              )}
              aria-hidden={!tabsVisible}
              inert={!tabsVisible}
            >
              {renderTabs(false)}
            </div>
            <div className="relative min-h-0 flex-1">
              {panel === 'lyrics' ? (
                lyricLoading && !lyricLines.length ? (
                  <div
                    className="flex h-full flex-col items-center justify-center gap-2.5 text-[12px] text-ink-4"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    <Trans>正在加载歌词…</Trans>
                  </div>
                ) : (
                  <LyricsPanel
                    key={currentSong.id}
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    onSeek={handleSeek}
                    className="h-full"
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
                  <LiveLyricStage
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    onSeek={handleSeek}
                    className="h-full"
                  />
                )
              ) : panel === 'queue' ? (
                <div className="relative flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
                      <input
                        value={queueSearch}
                        onChange={(event) => {
                          setQueueSearch(event.target.value)
                          queueListRef.current?.scrollTo({ top: 0 })
                          queueScrollRef.current?.scrollTo({ top: 0 })
                        }}
                        placeholder={i18n._(msg`搜索待播歌曲`)}
                        aria-label={i18n._(msg`搜索待播歌曲`)}
                        className="h-8 w-full rounded-full bg-white/10 pl-8 pr-7 text-[12px] text-white/85 outline-none shadow-none placeholder:text-white/30 focus:bg-white/14"
                      />
                      {queueSearch ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQueueSearch('')
                            queueListRef.current?.scrollTo({ top: 0 })
                            queueScrollRef.current?.scrollTo({ top: 0 })
                          }}
                          aria-label={i18n._(msg`清除搜索`)}
                          className="pressable absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <div
                      role="group"
                      aria-label={i18n._(msg`队列视图`)}
                      className="flex shrink-0 items-center rounded-full bg-white/8 p-0.5"
                    >
                      <button
                        type="button"
                        aria-label={i18n._(msg`列表视图`)}
                        title={i18n._(msg`列表视图`)}
                        aria-pressed={queueView === 'list'}
                        onClick={() => setQueueView('list')}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                          queueView === 'list'
                            ? 'bg-white/18 text-white'
                            : 'text-white/45 hover:bg-white/10 hover:text-white/80',
                        )}
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={i18n._(msg`网格视图`)}
                        title={i18n._(msg`网格视图`)}
                        aria-pressed={queueView === 'grid'}
                        onClick={() => setQueueView('grid')}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                          queueView === 'grid'
                            ? 'bg-white/18 text-white'
                            : 'text-white/45 hover:bg-white/10 hover:text-white/80',
                        )}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {queueView === 'list' ? (
                    <>
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
                                  // The current row is a neutral glass pill (CSS):
                                  // tinting it with the cover colour turned it
                                  // into a muddy band on a backdrop already
                                  // painted in that colour.
                                  backgroundColor:
                                    !active && dragOverQueueIndex === originalIndex
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
                                    <span
                                      className={cn('np-eq', playing && 'is-playing')}
                                      aria-label={
                                        playing
                                          ? i18n._(msg`正在播放`)
                                          : i18n._(msg`已暂停`)
                                      }
                                      role="img"
                                    >
                                      <i />
                                      <i />
                                      <i />
                                    </span>
                                  ) : (
                                    String(originalIndex + 1).padStart(2, '0')
                                  )}
                                </span>
                                <ImageWithFallback
                                  src={song.al.picUrl}
                                  alt={song.name}
                                  rounded="rounded-[6px]"
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
                      aria-hidden={!showQueueLocate}
                      tabIndex={showQueueLocate ? 0 : -1}
                      className={cn(
                        'pressable absolute bottom-1.5 right-1.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white/75 shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-[opacity,background-color] duration-200 hover:bg-white/15 hover:text-white',
                        showQueueLocate
                          ? 'opacity-100'
                          : 'pointer-events-none opacity-0',
                      )}
                    >
                      <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  ) : null}
                    </>
                  ) : (
                    <div
                      ref={queueScrollRef}
                      className="min-h-0 flex-1 overflow-y-auto px-2 pb-8 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {queue.length ? (
                        queueEntries.length ? (
                          <div
                            className="relative w-full"
                            style={{ height: `${queueVirtualizer.getTotalSize()}px` }}
                          >
                            {queueVirtualizer.getVirtualItems().map((virtualRow) => {
                              const start = virtualRow.index * queueColumns
                              const rowEntries = queueEntries.slice(
                                start,
                                start + queueColumns,
                              )
                              return (
                                <div
                                  key={virtualRow.key}
                                  className="np-song-row"
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: queueRowOffset,
                                    right: 0,
                                    height: `${queueRowHeight}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                    gridTemplateColumns: `repeat(${queueColumns}, ${queueTileWidth}px)`,
                                  }}
                                >
                                  {rowEntries.map(({ song, index }) => {
                                    const active = index === currentIndex
                                    return (
                                      <button
                                        key={`${song.id}-${index}`}
                                        type="button"
                                        title={song.name}
                                        aria-current={active ? 'true' : undefined}
                                        onClick={() => void playAt(index)}
                                        onContextMenu={(event) => {
                                          event.preventDefault()
                                          setQueueContext({
                                            song,
                                            x: event.clientX,
                                            y: event.clientY,
                                          })
                                        }}
                                        className={cn(
                                          'np-song-tile group',
                                          active && 'is-current',
                                        )}
                                      >
                                        <span className="np-song-tile__cover">
                                          <ImageWithFallback
                                            src={song.al.picUrl}
                                            alt={song.name}
                                            rounded="rounded-[14px]"
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
                            <Trans>没有匹配的歌曲</Trans>
                          </div>
                        )
                      ) : (
                        <div className="flex h-full min-h-[180px] items-center justify-center text-[12px] text-white/45">
                          <Trans>播放队列为空</Trans>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : panel === 'related' ? (
                <SimilarSongsPanel
                  key={currentSong.id}
                  songId={currentSong.id}
                  className="h-full"
                />
              ) : (
                <div className="h-full overflow-y-auto px-5 pb-8 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <CommentSection
                    key={currentSong.id}
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

      {!mvMode ? (
        <div className="nowplaying-close-control electrobun-webkit-app-region-no-drag absolute left-4 top-4 z-[210] max-md:fixed max-md:left-4 max-md:top-4">
          <button
            type="button"
            aria-label={i18n._(msg`收起播放页`)}
            onClick={requestClose}
            className="np-round-button pressable flex h-9 w-9 items-center justify-center rounded-full text-white/75"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {videoActive ? (
        <ImmersivePlayerBar onRequestClose={requestClose} />
      ) : null}

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

/** Vinyl/cover artwork fed with the live position without re-rendering NowPlaying. */
function LivePlayerArtwork(props: Omit<ComponentProps<typeof PlayerArtwork>, 'position'>) {
  const position = usePlayerStore(selectOverlayTime)
  return <PlayerArtwork {...props} position={position} />
}

/** Word-by-word lyric stage; owns the time subscription for the same reason. */
function LiveLyricStage(props: Omit<ComponentProps<typeof LyricStage>, 'currentTime'>) {
  const currentTime = usePlayerStore(selectOverlayTime)
  return <LyricStage {...props} currentTime={currentTime * 1000} />
}
