import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react'
import { Trans } from '@lingui/react/macro'
import type { LyricLine, LyricWord } from '../../lib/lyric'
import {
  buildLyricTimeline,
  groupWordChunks,
  lineShowsWords,
  type TimedLine,
} from '../../lib/lyricTimeline'
import {
  LYRIC_FONT_SIZE_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import { cn } from '../../lib/format'
import { ClassicLyricsPanel } from './ClassicLyricsPanel'
import { LyricScrollEngine } from './lyricEngine'

interface LyricsPanelProps {
  lines: LyricLine[]
  /**
   * Line index from the player store. The panel follows the audio clock
   * itself (frame accurate); a change here only triggers a re-sync.
   */
  activeIndex: number
  onSeek: (timeMs: number) => void
  className?: string
  compact?: boolean
}

/**
 * Word spans of one line. Nothing here depends on the playhead: the wipe,
 * float and glow are written by `LyricScrollEngine` every frame.
 */
function LineWords({
  words,
  timed,
  onSeek,
}: {
  words: LyricWord[]
  timed: TimedLine | undefined
  onSeek: (timeMs: number) => void
}) {
  const chunks = useMemo(() => groupWordChunks(words), [words])
  return (
    <>
      {chunks.map((chunk) => (
        <span key={chunk[0]} className="lyric-chunk">
          {chunk.map((index) => {
            const word = words[index]
            const emphasize = Boolean(timed?.words[index]?.emphasize)
            return (
              <span
                key={`${index}-${word.startTime}`}
                data-lyric-word=""
                className={cn(
                  'lyric-word lyric-word--interactive',
                  emphasize && 'is-emphasis',
                )}
                // Only real syllable timings render words, so every word seeks.
                onClick={(event) => {
                  event.stopPropagation()
                  onSeek(word.startTime)
                }}
              >
                {emphasize
                  ? Array.from(word.content).map((char, charIndex) => (
                      <span key={charIndex} data-lyric-char="" className="lyric-char">
                        {char}
                      </span>
                    ))
                  : word.content}
              </span>
            )
          })}
        </span>
      ))}
    </>
  )
}

function InterludeDots({ index }: { index: number }) {
  return (
    <div data-lyric-interlude={index} className="lyric-interlude" aria-hidden="true">
      <span className="lyric-interlude__dots">
        <span className="lyric-interlude__dot" />
        <span className="lyric-interlude__dot" />
        <span className="lyric-interlude__dot" />
      </span>
    </div>
  )
}

/**
 * Apple Music style lyrics: per-syllable gradient wipe with a soft edge,
 * sung words float up, long held notes glow letter by letter, "…" dots fill
 * instrumental breaks, and lines glide on springs in a staggered wave. Wheel
 * or drag to browse; it follows playback again after a few seconds.
 */
const AppleLyricsPanel = memo(function AppleLyricsPanel({
  lines,
  activeIndex,
  onSeek,
  className,
  compact,
}: LyricsPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<LyricScrollEngine | null>(null)
  const displayMode = useSettingsStore((state) => state.lyricDisplayMode)
  const lyricFontSize = useSettingsStore((state) => state.lyricFontSize)
  const wordByWordLyrics = useSettingsStore((state) => state.wordByWordLyrics)
  const fontScale =
    LYRIC_FONT_SIZE_OPTIONS.find((option) => option.value === lyricFontSize)
      ?.scale ?? 1
  const hasLines = lines.length > 0

  const showWords = useCallback(
    (line: LyricLine) =>
      lineShowsWords(line, {
        wordByWord: wordByWordLyrics,
        translationOnly: displayMode === 'translation',
      }),
    [wordByWordLyrics, displayMode],
  )
  const timeline = useMemo(
    () => buildLyricTimeline(lines, { showWords }),
    [lines, showWords],
  )
  const interludeBefore = useMemo(() => {
    const map = new Map<number, number>()
    timeline.interludes.forEach((interlude, index) => {
      map.set(interlude.beforeLine, index)
    })
    return map
  }, [timeline])

  // The engine owns the lyric DOM's motion. A new timeline (other song,
  // word-by-word / display mode toggled) gets a fresh engine that snaps
  // straight to the current line.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!hasLines || !viewport || !track) return
    const engine = new LyricScrollEngine(viewport, track, {
      align: compact ? 0.4 : 0.35,
    })
    engineRef.current = engine
    engine.setTimeline(timeline)
    engine.syncDom()
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [hasLines, compact, timeline])

  // Plain re-renders keep the same nodes; re-read them so the engine never
  // holds detached word spans.
  useLayoutEffect(() => {
    engineRef.current?.syncDom()
  }, [activeIndex, displayMode, fontScale])

  const handleSeek = useCallback(
    (timeMs: number) => {
      engineRef.current?.resumeFollow()
      onSeek(timeMs)
    },
    [onSeek],
  )

  if (!hasLines) {
    return (
      <div className={cn('flex h-full items-center justify-center text-[12px] text-ink-4', className)}>
        <Trans>暂无歌词，请欣赏</Trans>
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      style={{ '--lyric-font-scale': fontScale } as CSSProperties}
      className={cn(
        'lyrics-viewport relative h-full overflow-clip px-6',
        compact && 'lyrics-viewport--compact',
        className,
      )}
    >
      <div ref={trackRef} className="lyrics-track">
        {lines.map((line, index) => {
          const interlude = interludeBefore.get(index)
          const hasWords = showWords(line)
          const translationOnly = displayMode === 'translation' && Boolean(line.translate)
          const text = translationOnly ? line.translate! : line.content
          return (
            <Fragment key={`${line.time}-${index}`}>
              {interlude !== undefined ? <InterludeDots index={interlude} /> : null}
              <button
                data-lyric-line={index}
                type="button"
                // The whole padded row seeks, not only the glyphs.
                onClick={() => handleSeek(line.time)}
                className="lyric-line block w-full text-left"
              >
                <span className="lyric-line__text">
                  {hasWords ? (
                    <LineWords
                      words={line.words!}
                      timed={timeline.lines[index]}
                      onSeek={handleSeek}
                    />
                  ) : (
                    text
                  )}
                </span>
                {displayMode === 'both' && line.translate ? (
                  <span className="mt-1 block">
                    <span className="lyric-line__translate inline-block max-w-full">
                      {line.translate}
                    </span>
                  </span>
                ) : null}
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
})

/**
 * Lyric list of the now-playing page. "Apple Music 歌词动效" in Settings picks
 * the Apple style renderer; off keeps the classic word-by-word fill.
 */
export const LyricsPanel = memo(function LyricsPanel(props: LyricsPanelProps) {
  const appleLyricsEffect = useSettingsStore((state) => state.appleLyricsEffect)
  return appleLyricsEffect ? (
    <AppleLyricsPanel {...props} />
  ) : (
    <ClassicLyricsPanel {...props} />
  )
})
