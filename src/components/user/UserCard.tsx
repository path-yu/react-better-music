import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Avatar } from '@pikoloo/darwin-ui'
import { formatNumber } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import type { UserSummary } from '../../types'

interface UserCardProps {
  user: UserSummary
}

export function UserCard({ user }: UserCardProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() =>
        void navigate({ to: '/users/$id', params: { id: String(user.userId) } })
      }
      className="group flex w-full items-center gap-3 rounded-[14px] border border-black/8 bg-white/55 p-3 text-left transition-colors hover:bg-white/80"
    >
      <Avatar
        src={resizedImageUrl(user.avatarUrl, '200y200') ?? user.avatarUrl}
        alt={user.nickname}
        fallback={user.nickname?.slice(0, 1)}
        size="lg"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-black/75 group-hover:text-accent">
          {user.nickname}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-black/35">
          {user.signature?.trim() || i18n._(msg`暂无简介`)}
        </p>
        <p className="mt-1 flex items-center gap-2 text-[11px] text-black/25">
          <span>
            <Trans>{formatNumber(user.followeds)} 位粉丝</Trans>
          </span>
          <span>·</span>
          <span>
            <Trans>{user.playlistCount ?? 0} 个歌单</Trans>
          </span>
        </p>
      </div>
    </button>
  )
}
