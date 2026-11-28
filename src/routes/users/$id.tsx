import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { CalendarDays, Check, Disc3, UserPlus, UserRound } from 'lucide-react'
import { Avatar, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { EmptyState } from '../../components/common/EmptyState'
import { AlbumCard } from '../../components/cards/AlbumCard'
import { PlaylistCard } from '../../components/cards/PlaylistCard'
import {
  fetchCollectedAlbums,
  fetchUserDetail,
  fetchUserPlaylists,
  subscribeUser,
} from '../../api'
import { extractPalette, withAlpha } from '../../lib/color'
import { cn, formatDate, formatNumber } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import { useDocumentTitle } from '../../lib/title'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useUserStore } from '../../store/user'
import { toast } from '../../lib/toast'
import type { Album, Playlist, UserProfile } from '../../types'

export const Route = createFileRoute('/users/$id')({
  component: UserDetailPage,
})

type ProfileTab = 'created' | 'collected' | 'albums'

/** NetEase Cloud Music launched in 2013; older or empty stamps are bogus (1970-01-01). */
const EARLIEST_JOIN = Date.UTC(2013, 0, 1)

function validJoinTime(createTime?: number) {
  const time = Number(createTime)
  return Number.isFinite(time) && time >= EARLIEST_JOIN && time <= Date.now()
    ? time
    : null
}

function UserDetailPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [level, setLevel] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<ProfileTab>('created')
  const [albums, setAlbums] = useState<Album[]>([])
  const [albumTotal, setAlbumTotal] = useState(0)
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [albumsLoaded, setAlbumsLoaded] = useState(false)
  const [albumsFailed, setAlbumsFailed] = useState(false)
  const [albumAttempt, setAlbumAttempt] = useState(0)
  const currentUserId = useUserStore((state) => state.profile?.userId)
  const isLogin = useUserStore((state) => state.isLogin)
  const localSubscribedUsers = useLocalLibraryStore(
    (state) => state.subscribedUsers,
  )
  const toggleLocalUser = useLocalLibraryStore(
    (state) => state.toggleSubscribedUser,
  )
  const [followed, setFollowed] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  // Soft avatar colour in the header instead of the blurred background image,
  // which turned into a muddy brown wash on most profiles.
  const [tint, setTint] = useState<string | null>(null)

  useDocumentTitle(profile?.nickname ?? i18n._(msg`用户`))

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    Promise.allSettled([
      fetchUserDetail(id, controller.signal),
      fetchUserPlaylists(id, controller.signal),
    ])
      .then(([detailResult, playlistResult]) => {
        if (controller.signal.aborted) return
        if (detailResult.status === 'rejected') {
          setFailed(true)
          toast.error(i18n._(msg`用户信息加载失败`))
          return
        }
        setProfile(detailResult.value.profile ?? null)
        setLevel(detailResult.value.level ?? 0)
        if (playlistResult.status === 'fulfilled') {
          setPlaylists(playlistResult.value)
        } else {
          // A private/broken playlist response should not hide the profile.
          setPlaylists([])
          toast.warning(i18n._(msg`歌单加载失败`))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // The request is keyed by the route id and retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])

  useEffect(() => {
    setAlbums([])
    setAlbumTotal(0)
    setAlbumsLoaded(false)
    setAlbumsFailed(false)
    setTab('created')
    setTint(null)
  }, [id])

  const avatarUrl = profile
    ? (resizedImageUrl(profile.avatarUrl, '200y200') ?? profile.avatarUrl)
    : ''

  useEffect(() => {
    if (!avatarUrl) return
    let active = true
    void extractPalette(avatarUrl)
      .then((palette) => {
        if (!active || palette.source === 'fallback') return
        setTint(palette.colors[0] ?? null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [avatarUrl])

  // album/sublist is tied to the signed-in cookie, not a uid parameter. Only
  // query it on the owner's own profile so another user's page can never
  // display the viewer's private album library.
  const isOwnProfile = Boolean(
    profile &&
      currentUserId &&
      String(profile.userId) === String(currentUserId),
  )

  useEffect(() => {
    if (tab !== 'albums' || !isOwnProfile || albumsLoaded) return
    const controller = new AbortController()
    setAlbumsLoading(true)
    setAlbumsFailed(false)
    fetchCollectedAlbums(1000, 0, controller.signal)
      .then(({ albums: list, count }) => {
        if (controller.signal.aborted) return
        setAlbums(list)
        setAlbumTotal(count)
        setAlbumsLoaded(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setAlbumsFailed(true)
        toast.error(i18n._(msg`收藏专辑加载失败`))
      })
      .finally(() => {
        if (!controller.signal.aborted) setAlbumsLoading(false)
      })
    return () => controller.abort()
    // The request is intentionally keyed by the profile, tab and retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isOwnProfile, albumsLoaded, albumAttempt])

  // Guests follow into the local library, the signed-in account into NetEase;
  // re-derive whenever either side changes (login, id, local edits).
  useEffect(() => {
    if (!profile) return
    setFollowed(
      isLogin
        ? Boolean(profile.followed)
        : localSubscribedUsers.some(
            (item) => Number(item.userId) === Number(profile.userId),
          ),
    )
  }, [profile, isLogin, localSubscribedUsers])

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

  const handleToggleFollow = async () => {
    if (!profile || followBusy || isOwnProfile) return
    setFollowBusy(true)
    const next = !followed
    try {
      if (isLogin) {
        if (!(await subscribeUser(profile.userId, next))) {
          throw new Error('follow failed')
        }
        setProfile((current) =>
          current ? { ...current, followed: next } : current,
        )
        setFollowed(next)
        // Keep the sidebar's "关注的用户" in step without a reload.
        void useUserStore.getState().loadFollowedUsers()
      } else {
        const result = await toggleLocalUser(profile)
        if (result === null) return
        setFollowed(result)
      }
      toast.success(next ? i18n._(msg`已关注`) : i18n._(msg`已取消关注`))
    } catch {
      toast.error(i18n._(msg`操作失败`))
    } finally {
      setFollowBusy(false)
    }
  }

  if (failed || (!loading && !profile)) {
    return (
      <div className="page">
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
      <div className="page">
        <Skeleton className="h-[184px] w-full rounded-[22px]" />
        <Skeleton className="mt-6 h-8 w-72 rounded-full" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square w-full rounded-[18px]" />
          ))}
        </div>
      </div>
    )
  }

  const signature = profile.signature?.trim() ?? ''
  // The 简介 card only appears when it says more than the signature already
  // shown in the header (it used to repeat the signature as a whole card).
  const about =
    profile.detailDescription?.trim() || profile.description?.trim() || ''
  const showAbout = Boolean(about) && about !== signature
  const joinTime = validJoinTime(profile.createTime)
  const heroStyle = tint
    ? ({ '--profile-tint': withAlpha(tint, 0.55) } as CSSProperties)
    : undefined

  return (
    <div className="page">
      <div
        className="relative overflow-hidden rounded-[22px] border border-black/[0.06] bg-white/55"
        style={heroStyle}
      >
        <div
          className={cn('user-profile-hero__tint absolute inset-0', tint && 'is-ready')}
          aria-hidden="true"
        />
        <div className="user-profile-hero__scrim absolute inset-0" aria-hidden="true" />

        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <Avatar
            src={avatarUrl}
            alt={profile.nickname}
            fallback={profile.nickname?.slice(0, 1)}
            size="xl"
            className="h-28 w-28 shrink-0 border border-white/60 shadow-[0_10px_30px_rgba(0,0,0,0.16)]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">
                <Trans>用户</Trans>
              </p>
              {level > 0 ? (
                <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink-3 dark:bg-white/10">
                  Lv.{level}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="headline-lg line-clamp-1">{profile.nickname}</h1>
              {isOwnProfile ? null : (
                <button
                  type="button"
                  disabled={followBusy}
                  aria-pressed={followed}
                  onClick={() => void handleToggleFollow()}
                  className={cn(
                    'pressable inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors disabled:opacity-50',
                    // A tinted pill instead of a solid blue button, so the
                    // nickname stays the strongest element in the header.
                    followed
                      ? 'bg-black/[0.06] text-ink-2 hover:bg-black/[0.1] dark:bg-white/10 dark:hover:bg-white/15'
                      : 'bg-accent/12 text-accent hover:bg-accent/20',
                  )}
                >
                  {followed ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" />
                  )}
                  {followed ? <Trans>已关注</Trans> : <Trans>关注</Trans>}
                </button>
              )}
            </div>
            {signature ? (
              <p className="mt-1.5 line-clamp-2 max-w-[680px] text-[12px] leading-relaxed text-ink-3">
                {signature}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
              <span>
                <strong className="font-semibold text-ink-2">
                  {formatNumber(profile.follows)}
                </strong>{' '}
                <Trans>关注</Trans>
              </span>
              <span>
                <strong className="font-semibold text-ink-2">
                  {formatNumber(profile.followeds)}
                </strong>{' '}
                <Trans>粉丝</Trans>
              </span>
              <span>
                <strong className="font-semibold text-ink-2">
                  {formatNumber(profile.playlistCount)}
                </strong>{' '}
                <Trans>歌单</Trans>
              </span>
              {joinTime ? (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <Trans>加入于 {formatDate(joinTime)}</Trans>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showAbout ? (
        <section className="apple-card mt-4 p-5">
          <p className="eyebrow text-left">
            <Trans>简介</Trans>
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">
            {about}
          </p>
        </section>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ProfileTab)}
        className="mt-6"
      >
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--app-border)] sticky-bar py-2 page-bleed">
          <TabsList>
            <TabsTrigger value="created">
              <Trans>创建的歌单</Trans> ({createdPlaylists.length})
            </TabsTrigger>
            <TabsTrigger value="collected">
              <Trans>收藏的歌单</Trans> ({collectedPlaylists.length})
            </TabsTrigger>
            <TabsTrigger value="albums">
              <Trans>收藏的专辑</Trans>
              {isOwnProfile && albumsLoaded ? ` (${albumTotal})` : ''}
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

        <TabsContent value="albums" className="mt-4">
          {!isOwnProfile ? (
            <EmptyState
              icon={<Disc3 className="h-6 w-6" />}
              title={i18n._(msg`该用户的收藏专辑不可见`)}
            />
          ) : albumsLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-square w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : albumsFailed ? (
            <EmptyState
              variant="error"
              title={i18n._(msg`收藏专辑加载失败`)}
              description={i18n._(msg`请检查网络或本地 API 服务后重试`)}
              onRetry={() => {
                setAlbumsFailed(false)
                setAlbumAttempt((value) => value + 1)
              }}
            />
          ) : albums.length ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {albums.map((album, index) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  priority={index < 5}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Disc3 className="h-6 w-6" />}
              title={i18n._(msg`还没有收藏专辑`)}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
