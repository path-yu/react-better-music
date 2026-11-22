import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { fetchNewSongs } from '../api'
import { cn } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { Song } from '../types'

import { PageHeader } from '../components/common/PageHeader'
export const Route = createFileRoute('/latest-music')({
  component: LatestMusicPage,
})

const TYPES = [
  { value: 0, label: msg`全部` },
  { value: 7, label: msg`华语` },
  { value: 96, label: msg`欧美` },
  { value: 8, label: msg`日本` },
  { value: 16, label: msg`韩国` },
] as const

type NewSongType = (typeof TYPES)[number]['value']

function LatestMusicPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`最新音乐`))
  const [type, setType] = useState<NewSongType>(0)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchNewSongs(type)
      .then((list) => {
        if (!cancelled) setSongs(list)
      })
      .catch(() => {
        if (!cancelled) toast.error(i18n._(msg`新歌加载失败`))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type])

  return (
    <div className="page">
      <PageHeader
        eyebrow={<Trans>发现音乐</Trans>}
        title={<Trans>最新音乐</Trans>}
        description={<Trans>每日更新的华语与全球新歌速递</Trans>}
        actions={<PlayAllButton songs={songs} playlistId={`top-song-${type}`} />}
      />

      <div className="sticky top-0 z-20 mt-4 flex gap-1.5 border-b border-[var(--app-border)] sticky-bar py-2.5 page-bleed">
        {TYPES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setType(item.value)}
            aria-pressed={type === item.value}
            className={cn('chip', type === item.value && 'chip--selected')}
          >
            {i18n._(item.label)}
          </button>
        ))}
      </div>

      <div className="mt-2">
        <SongTable
          songs={songs}
          playlistId={`top-song-${type}`}
          loading={loading}
          emptyText={i18n._(msg`暂无新歌`)}
        />
      </div>
    </div>
  )
}
