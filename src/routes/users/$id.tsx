import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, CalendarDays, UserRound } from 'lucide-react'
import { Avatar, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { EmptyState } from '../../components/common/EmptyState'
import { PlaylistCard } from '../../components/cards/PlaylistCard'
import { fetchUserDetail, fetchUserPlaylists } from '../../api'
import { formatDate, formatNumber } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'
import type { Playlist, UserProfile } from '../../types'

export const Route = createFileRoute('/users/$id')({
  component: UserDetailPage,
})

type PlaylistTab = 'created' | 'collected'

function UserDetailPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [level, setLevel] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<PlaylistTab>('created')

  useDocumentTitle(profile?.nickname ?? i18n._(msg`用户`))

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    Promise.all([
      fetchUserDetail(id, controller.signal),
      fetchUserPlaylists(id, controller.signal),
    ])
      .then(([detail, list]) => {
        if (controller.signal.aborted) return
        setProfile(detail.profile ?? null)
        setLevel(detail.level ?? 0)
        setPlaylists(list)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFailed(true)
        toast.error(i18n._(msg`用户信息加载失败`))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // The request is keyed by the route id and retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])

  const createdPlaylists = useMemo(
    () =>
      playlists.filter(
        (playlist) =>
          String(playlist.creator?.userId ?? playlist.userId ?? '') === String(id),
      ),
    [id, playlists],
  )

  const collectedPlaylists = useMemo(
    () =>
      playlists.filter(
        (playlist) =>
          String(playlist.creator?.userId ?? playlist.userId ?? '') !== String(id),
      ),
    [id, playlists],
  )

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      void navigate({ to: '/' })
    }
  }

  if (failed || (!loading && !profile)) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          variant="error"
          title={i18n._(msg`用户不存在或无法访问`)}
          description={i18n._(msg`请检查网络或用户主页是否公开`)}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    )
  }

  if (loading || !profile) {
    return (
      <div className="px-8 pb-14 pt-6">
        <Skeleton className="h-[240px] w-full rounded-[22px]" />
        <Skeleton className="mt-5 h-4 w-24 rounded-full" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square w-full rounded-[16px]" />
          ))}
        </div>
      </div>
    )
  }

  const background = resizedImageUrl(profile.backgroundUrl, '1280y400')
  const bio =
    profile.detailDescription?.trim() ||
    profile.description?.trim() ||
    profile.signature?.trim() ||
    i18n._(msg`暂无简介`)

  return (
    <div className="px-8 pb-14 pt-6">
      <div className="relative overflow-hidden rounded-[22px] border border-black/[0.06] bg-white/55">
        {background ? (
          <img
            src={background}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-white/85 via-white/45 to-transparent" />
        <button
          type="button"
          onClick={goBack}
          className="pressable absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] text-black/45 backdrop-blur-md transition-colors hover:bg-white/80 hover:text-black/75"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <Trans>返回</Trans>
        </button>

        <div className="relative flex flex-col gap-5 px-6 pb-6 pt-16 sm:flex-row sm:items-end">
          <Avatar
            src={resizedImageUrl(profile.avatarUrl, '200y200') ?? profile.avatarUrl}
            alt={profile.nickname}
            fallback={profile.nickname?.slice(0, 1)}
            size="xl"
            className="h-24 w-24 shrink-0 border border-white/60 shadow-[0_10px_30px_rgba(0,0,0,0.16)]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">
                <Trans>用户</Trans>
              </p>
              {level > 0 ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  Lv.{level}
                </span>
              ) : null}
            </div>
            <h1 className="headline-lg mt-1.5 line-clamp-1">{profile.nickname}</h1>
            <p className="mt-1.5 line-clamp-2 max-w-[680px] text-[12px] leading-relaxed text-black/45">
              {profile.signature?.trim() || i18n._(msg`暂无简介`)}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-black/40">
              <span>
                <strong className="font-semibold text-black/70">
                  {formatNumber(profile.follows)}
                </strong>{' '}
                <Trans>关注</Trans>
              </span>
              <span>
                <strong className="font-semibold text-black/70">
                  {formatNumber(profile.followeds)}
                </strong>{' '}
                <Trans>粉丝</Trans>
              </span>
              <span>
                <strong className="font-semibold text-black/70">
                  {formatNumber(profile.playlistCount)}
                </strong>{' '}
                <Trans>歌单</Trans>
              </span>
              {profile.createTime ? (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <Trans>加入于 {formatDate(profile.createTime)}</Trans>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <section className="apple-card mt-4 p-5">
        <p className="eyebrow text-left">
          <Trans>简介</Trans>
        </p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-black/60">
          {bio}
        </p>
      </section>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as PlaylistTab)}
        className="mt-6"
      >
        <div className="border-b border-black/8 pb-2">
          <TabsList>
            <TabsTrigger value="created">
              <Trans>创建的歌单</Trans> ({createdPlaylists.length})
            </TabsTrigger>
            <TabsTrigger value="collected">
              <Trans>收藏的歌单</Trans> ({collectedPlaylists.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {(['created', 'collected'] as const).map((value) => {
          const list = value === 'created' ? createdPlaylists : collectedPlaylists
          return (
            <TabsContent key={value} value={value} className="mt-4">
              {list.length ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {list.map((playlist, index) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      priority={index < 5}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<UserRound className="h-6 w-6" />}
                  title={
                    value === 'created'
                      ? i18n._(msg`该用户还没有创建歌单`)
                      : i18n._(msg`该用户还没有收藏歌单`)
                  }
                />
              )}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
