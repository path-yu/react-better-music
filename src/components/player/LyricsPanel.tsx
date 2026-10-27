import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LyricLine, LyricWord } from '../../lib/lyric'
import { useSettingsStore } from '../../store/settings'
import { getAudio } from '../../lib/audio'
import { cn } from '../../lib/format'

interface LyricsPanelProps {
  lines: LyricLine[]
  activeIndex: number
  currentTimeMs: number
  onSeek: (timeMs: number) => void
  className?: string
  compact?: boolean
}

function wordStyle(
  word: LyricWord,
  timeMs: number,
  active: boolean,
): CSSProperties {
  if (!active) return {}
  const duration = Math.max(1, word.duration)
  const progress = Math.min(100, Math.max(0, ((timeMs - word.startTime) / duration) * 100))
  if (progress >= 100) {
    return { color: 'var(--lyric-active)' }
  }
  if (progress <= 0) {
    return { color: 'var(--lyric-dim)' }
  }
  return {
    backgroundImage: `linear-gradient(90deg, var(--lyric-active) ${progress}%, var(--lyric-dim) ${progress}%)`,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  }
}

/**
 * Word-by-word highlighting is the only lyric content that needs a high refresh
 * rate; isolating it keeps the rest of the list from re-rendering at 30fps.
 */
function ActiveWords({
  words,
  currentTimeMs,
}: {
  words: LyricWord[]
  currentTimeMs: number
}) {
  const [clockMs, setClockMs] = useState(currentTimeMs)

  useEffect(() => {
    let frame = 0
    let last = 0
    const tick = (timestamp: number) => {
      frame = requestAnimationFrame(tick)
      if (timestamp - last < 32) return
      last = timestamp
      const audio = getAudio()
      if (!audio || audio.paused) return
      setClockMs(audio.currentTime * 1000)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const audio = getAudio()
    if (audio && !audio.paused) return
    setClockMs(currentTimeMs)
  }, [currentTimeMs])

  return (
    <>
      {words.map((word, index) => (
        <span
          key={`${index}-${word.startTime}`}
          className="lyric-word"
          style={wordStyle(word, clockMs, true)}
        >
          {word.content}
        </span>
      ))}
    </>
  )
}

export function LyricsPanel({
  lines,
  activeIndex,
  currentTimeMs,
  onSeek,
  className,
  compact,
}: LyricsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const lastActiveRef = useRef(-1)
  const showTranslation = useSettingsStore((state) => state.showLyricTranslation)

  useEffect(() => {
    const container = containerRef.current
    const active = lineRefs.current[activeIndex]
    if (!container || !active) return
    // A seek can jump many lines; scrolling smoothly across a long distance
    // fights the next update and makes the whole panel look shaky.
    const jump = Math.abs(activeIndex - lastActiveRef.current)
    lastActiveRef.current = activeIndex
    const behavior: ScrollBehavior = jump > 2 ? 'auto' : 'smooth'
    // On mobile the viewport is not scrollable on purpose (the whole page is);
    // keep the active line centred by scrolling its nearest ancestor instead.
    if (container.scrollHeight <= container.clientHeight + 1) {
      active.scrollIntoView({ block: 'center', inline: 'nearest', behavior })
      return
    }
    const top = active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior })
  }, [activeIndex])

  if (!lines.length) {
    return (
      <div className={cn('flex h-full items-center justify-center text-[12px] text-black/35', className)}>
        暂无歌词，请欣赏
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'lyrics-viewport relative h-full overflow-y-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Mobile keeps a single outer scroll container for the whole page.
        'max-md:h-auto max-md:overflow-visible',
        compact && 'lyrics-viewport--compact',
        className,
      )}
    >
      <div className={compact ? 'py-16' : 'py-[38%]'}>
        {lines.map((line, index) => {
          const active = index === activeIndex
          const away = activeIndex < 0 ? 0 : Math.abs(index - activeIndex)
          // Apple's context lines sit at a dim tertiary white and are defocused;
          // only the line being sung stays sharp.
          const opacity = active ? 1 : Math.max(0.3, 0.55 - away * 0.06)
          const blur = active || activeIndex < 0 ? 0 : Math.min(2.8, 0.9 + away * 0.42)
          const hasWords = Boolean(line.words?.length)
          return (
            <button
              key={`${line.time}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node
              }}
              type="button"
              onClick={() => onSeek(line.time)}
              style={
                {
                  '--lyric-opacity': opacity,
                  '--lyric-blur': `${blur.toFixed(2)}px`,
                } as CSSProperties
              }
              className={cn(
                'lyric-line block w-full text-left',
                active && 'is-active',
                blur > 0 && 'is-blurred',
              )}
            >
              <span className="lyric-line__text block">
                {active && hasWords ? (
                  <ActiveWords words={line.words!} currentTimeMs={currentTimeMs} />
                ) : (
                  line.content
                )}
              </span>
              {showTranslation && line.translate ? (
                <span className="lyric-line__translate mt-1 block">{line.translate}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
