import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Heart, ListMusic } from 'lucide-react'
import { SongTable } from '../../components/songs/SongTable'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { EmptyState } from '../../components/common/EmptyState'
import { Button } from '@pikoloo/darwin-ui'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useDocumentTitle } from '../../lib/title'

import { PageHeader } from '../../components/common/PageHeader'
export const Route = createFileRoute('/local/favorites')({
  component: LocalFavoritesPage,
})

function LocalFavoritesPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`我喜欢的音乐`))
  const navigate = useNavigate()
  const favorites = useLocalLibraryStore((state) => state.favorites)

  return (
    <div className="page">
      <PageHeader
        title={<Trans>我喜欢的音乐</Trans>}
        description={<Trans>保存在安装目录的本地收藏，不需要登录</Trans>}
        actions={<PlayAllButton songs={favorites} playlistId="local-favorites" />}
      />

      <div className="mt-5">
        {favorites.length ? (
          <SongTable
            songs={favorites}
            playlistId="local-favorites"
            emptyText={i18n._(msg`还没有喜欢的歌曲`)}
          />
        ) : (
          <EmptyState
            icon={<Heart className="h-6 w-6" />}
            title={i18n._(msg`还没有喜欢的歌曲`)}
            description={i18n._(msg`在歌曲右侧点击心形，收藏会写入本地曲库。`)}
            action={
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full px-4"
                onClick={() => void navigate({ to: '/songlists' })}
              >
                <ListMusic className="mr-1.5 h-3.5 w-3.5" />
                <Trans>去发现音乐</Trans>
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}
