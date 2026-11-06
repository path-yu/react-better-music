import type { CSSProperties } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import type { LyricLine, LyricWord } from '../../lib/lyric'
import {
  LYRIC_STAGE_STYLE_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import { cn } from '../../lib/format'

interface LyricStageProps {
  lines: LyricLine[]
  activeIndex: number
  currentTime: number
  onSeek: (timeMs: number) => void
  className?: string
}

function scatter(seed: number, salt: number) {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function wordState(word: LyricWord, currentTime: number) {
  const end = word.startTime + Math.max(1, word.duration)
  return {
    sung: currentTime >= end,
    active: currentTime >= word.startTime && currentTime < end,
  }
}

function wordStyle(index: number, seed: number): CSSProperties {
  // Transforms do not affect flex layout. Keep the scatter smaller than the
  // gap between glyphs, otherwise adjacent words visually collide even though
  // their layout boxes do not overlap.
  return {
    '--stage-x': `${(scatter(seed + index, 1) - 0.5) * 10}px`,
    '--stage-y': `${(scatter(seed + index, 2) - 0.5) * 10}px`,
    '--stage-rotate': `${(scatter(seed + index, 3) - 0.5) * 3}deg`,
    '--stage-delay': `${index * 22}ms`,
  } as CSSProperties
}

function splitWords(words: LyricWord[], count: number) {
  const groups: LyricWord[][] = []
  let offset = 0
  for (let group = 0; group < count; group += 1) {
    const remaining = words.length - offset
    const left = count - group
    const size = group === count - 1 ? remaining : Math.ceil(remaining / left)
    groups.push(words.slice(offset, offset + size))
    offset += size
  }
  return groups.filter((group) => group.length > 0)
}

function charCount(words: LyricWord[]) {
  return words.reduce((sum, word) => sum + Array.from(word.content).length, 0)
}

function splitByCharacters(words: LyricWord[], count: number) {
  const total = Math.max(1, charCount(words))
  const groups: LyricWord[][] = []
  let offset = 0
  let seen = 0
  for (let group = 0; group < count; group += 1) {
    const target =
      group === count - 1
        ? words.length
        : Math.max(
            offset + 1,
            Math.round((total * (group + 1)) / count),
          )
    let until = offset
    let chars = seen
    while (until < words.length && chars < target) {
      chars += Array.from(words[until].content).length
      until += 1
    }
    groups.push(words.slice(offset, Math.max(until, offset + 1)))
    offset = Math.max(until, offset + 1)
    seen = chars
  }
  // Any words left after rounding land in the final part.
  if (offset < words.length) groups[groups.length - 1].push(...words.slice(offset))
  return groups.filter((group) => group.length > 0)
}

function FlowStage({
  line,
  words,
  currentTime,
  onSeek,
}: {
  line: LyricLine
  words: LyricWord[]
  currentTime: number
  onSeek: (timeMs: number) => void
}) {
  const seed = line.time / 1000
  return (
    <div className="np-stage__content">
      <button
        type="button"
        className="np-stage__line"
        onClick={() => onSeek(line.time)}
        aria-label={line.content}
      >
        {words.map((word, index) => {
          const state = wordState(word, currentTime)
          return (
            <span
              key={`${word.startTime}-${index}`}
              style={wordStyle(index, seed)}
              className={cn(
                'np-stage__word',
                state.sung && 'is-sung',
                state.active && 'is-active',
              )}
            >
              {word.content}
            </span>
          )
        })}
      </button>
    </div>
  )
}

function PartitaStage({
  line,
  words,
  currentTime,
  onSeek,
}: {
  line: LyricLine
  words: LyricWord[]
  currentTime: number
  onSeek: (timeMs: number) => void
}) {
  const seed = line.time / 1000
  const rows = splitWords(words, Math.min(4, Math.max(1, Math.ceil(words.length / 4))))
  return (
    <div className="np-stage__content np-stage__content--partita">
      <div className="np-stage-rows">
        {rows.map((row, rowIndex) => {
          const due = currentTime >= (row[0]?.startTime ?? 0) - 80
          const side = rowIndex % 2 === 0 ? -1 : 1
          return (
            <div
              key={`${rowIndex}-${row[0]?.startTime ?? 0}`}
              className={cn(
                'np-stage-row',
                due && 'is-due',
                rowIndex % 2 === 0 ? 'is-left' : 'is-right',
              )}
              style={
                {
                  '--stage-row-x': `${side * (24 + scatter(seed + rowIndex, 4) * 42)}px`,
                  '--stage-row-scale': 0.9 + scatter(seed + rowIndex, 5) * 0.2,
                  '--stage-row-delay': `${rowIndex * 60}ms`,
                } as CSSProperties
              }
            >
              <button
                type="button"
                onClick={() => onSeek(row[0]?.startTime ?? line.time)}
                aria-label={row.map((word) => word.content).join('')}
                className="np-stage-row__line"
              >
                {row.map((word, index) => {
                  const state = wordState(word, currentTime)
                  return (
                    <span
                      key={`${word.startTime}-${index}`}
                      style={wordStyle(index, seed + rowIndex * 7)}
                      className={cn(
                        'np-stage__word',
                        state.sung && 'is-sung',
                        state.active && 'is-active',
                      )}
                    >
                      {word.content}
                    </span>
                  )
                })}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TiltStage({
  line,
  words,
  currentTime,
  onSeek,
}: {
  line: LyricLine
  words: LyricWord[]
  currentTime: number
  onSeek: (timeMs: number) => void
}) {
  const totalChars = charCount(words)
  const parts = splitByCharacters(
    words,
    Math.min(4, Math.max(1, Math.ceil(totalChars / 9))),
  )
  const leanIndex = parts.length > 1 ? 1 : -1
  return (
    <div className="np-stage__content np-stage__content--tilt">
      {parts.map((part, partIndex) => {
        const due = currentTime >= (part[0]?.startTime ?? 0) - 250
        return (
          <button
            key={`${partIndex}-${part[0]?.startTime ?? 0}`}
            type="button"
            onClick={() => onSeek(part[0]?.startTime ?? line.time)}
            className={cn(
              'np-stage-tilt',
              partIndex === leanIndex && 'is-lean',
              due && 'is-due',
            )}
            style={
              {
                '--stage-tilt-delay': `${partIndex * 70}ms`,
              } as CSSProperties
            }
          >
            {part.map((word, wordIndex) => {
              const chars = Array.from(word.content)
              const each = word.duration / Math.max(1, chars.length)
              const state = wordState(word, currentTime)
              return (
                <span
                  key={`${word.startTime}-${wordIndex}`}
                  className={cn(
                    'np-stage-tilt__word',
                    state.sung && 'is-sung',
                    state.active && 'is-active',
                  )}
                >
                  {chars.map((char, charIndex) => {
                    const start = word.startTime + each * charIndex
                    const end = start + Math.max(1, each)
                    const sung = currentTime >= end
                    const active = currentTime >= start && !sung
                    return (
                      <span
                        key={`${charIndex}-${char}`}
                        className={cn(
                          'np-stage-tilt__char',
                          char.trim() === '' && 'is-space',
                          sung && 'is-sung',
                          active && 'is-active',
                        )}
                      >
                        {char === ' ' ? '\u00a0' : char}
                      </span>
                    )
                  })}
                </span>
              )
            })}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The "律动" stage: three interpretations of the current lyric line, following
 * the same line/word timings as the regular lyrics panel. Styles mirror the
 * native player's Folia-inspired 流光 / 云阶 / 倾诉 modes.
 */
export function LyricStage({
  lines,
  activeIndex,
  currentTime,
  onSeek,
  className,
}: LyricStageProps) {
  const { i18n } = useLingui()
  const stageStyle = useSettingsStore((state) => state.lyricStageStyle)
  const setStageStyle = useSettingsStore((state) => state.setLyricStageStyle)
  // Before the first timestamp, findLyricIndex returns -1. Lyrics do exist in
  // that intro window; show the upcoming first line instead of claiming there
  // are no lyrics at all.
  const displayIndex = activeIndex >= 0 ? activeIndex : 0
  const line = lines[displayIndex]
  if (!lines.length || !line) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-[13px] text-white/40',
          className,
        )}
      >
        <Trans>暂无歌词，请欣赏</Trans>
      </div>
    )
  }

  const words: LyricWord[] = line.words?.length
    ? line.words
    : [
        {
          content: line.content,
          startTime: line.time,
          duration: Math.max(
            1,
            (lines[displayIndex + 1]?.time ?? line.time + 5000) - line.time,
          ),
        },
      ]
  const next = lines[displayIndex + 1]

  return (
    <div className={cn('np-stage', className)}>
      <div className="np-stage__styles" role="group" aria-label={i18n._(msg`律动效果`)}>
        {LYRIC_STAGE_STYLE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={stageStyle === option.value}
            onClick={() => setStageStyle(option.value)}
            className={cn(
              'np-stage__style',
              stageStyle === option.value && 'is-active',
            )}
          >
            {i18n._(option.label)}
          </button>
        ))}
      </div>
      <div className="np-stage__glow" aria-hidden="true" />
      <div className="np-stage__body">
        {stageStyle === 'partita' ? (
          <PartitaStage
            line={line}
            words={words}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        ) : stageStyle === 'tilt' ? (
          <TiltStage
            line={line}
            words={words}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        ) : (
          <FlowStage
            line={line}
            words={words}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        )}

        {line.translate ? (
          <p className="np-stage__translation">{line.translate}</p>
        ) : null}
        {next ? <p className="np-stage__next">{next.content}</p> : null}
      </div>
    </div>
  )
}
