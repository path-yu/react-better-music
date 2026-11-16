import { useLingui } from '@lingui/react'
import {
  PLAYER_STYLE_OPTIONS,
  useSettingsStore,
  type PlayerStyle,
} from '../../store/settings'
import { cn } from '../../lib/format'
import deckArt from '../../assets/retro/deck.png'
import cassetteArt from '../../assets/retro/cassette.png'

export function PlayerStylePicker() {
  const { i18n } = useLingui()
  const playerStyle = useSettingsStore((state) => state.playerStyle)
  const setPlayerStyle = useSettingsStore((state) => state.setPlayerStyle)

  return (
    <div className="settings-style-grid" role="radiogroup">
      {PLAYER_STYLE_OPTIONS.map((option) => {
        const selected = playerStyle === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPlayerStyle(option.value as PlayerStyle)}
            className={cn(
              'settings-style-option pressable',
              selected && 'is-selected',
            )}
          >
            <StylePreview style={option.value} />
            <span>{i18n._(option.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

function StylePreview({ style }: { style: PlayerStyle }) {
  if (style === 'vinyl') {
    return (
      <img
        src={deckArt}
        alt=""
        className="settings-style-preview settings-style-preview--deck"
        draggable={false}
      />
    )
  }
  if (style === 'cassette') {
    return (
      <img
        src={cassetteArt}
        alt=""
        className="settings-style-preview settings-style-preview--tape"
        draggable={false}
      />
    )
  }
  return (
    <span className="settings-style-preview settings-style-preview--cover">
      <span />
    </span>
  )
}
