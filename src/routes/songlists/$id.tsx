import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  CalendarDays,
  Check,
  Heart,
  Pencil,
  Share2,
  Star,
} from 'lucide-react'
import {
  Avatar,
  Button,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import { SongTable } from '../../components/songs/SongTable'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { CommentSection } from '../../components/comments/CommentSection'
import {
  fetchPlaylistDetail,
  fetchPlaylistTracks,
  fetchRemainingPlaylistTracks,
  updatePlaylistSubscribe,
} from '../../api'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { toast } from '../../lib/toast'
import { useDocumentTitle } from '../../lib/title'
import {
  formatDate,
  formatNumber,
  matchesKeyword,
  cn,
} from '../../lib/format'
import type { Playlist, Song } from '../../types'

export const Route = createFileRoute('/songlists/$id')({
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Playlist | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('songs')
  const [keyword, setKeyword] = useState('')
  const [descExpanded, setDescExpanded] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  useDocumentTitle(detail?.name ?? '歌单')

  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const loadPlaylists = useUserStore((state) => state.loadPlaylists)
  const openLogin = useUiStore((state) => state.openLogin)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setDetail(null)
    setSongs([])
    setKeyword('')

    const load = async () => {
      try {
        // Detail and the first track page start together; remaining pages load
        // in the background with bounded concurrency.
        const [playlist, first] = await Promise.all([
          fetchPlaylistDetail(id, controller.signal),
          fetchPlaylistTracks(id, 300, 0, controller.signal),
        ])
        if (controller.signal.aborted) return
        setDetail(playlist)
        setSongs(first)
        setLoading(false)
        if (playlist.trackCount > first.length) {
          const rest = await fetchRemainingPlaylistTracks(
            id,
            playlist.trackCount,
            controller.signal,
          )
          if (!controller.signal.aborted) setSongs([...first, ...rest])
        }
      } catch {
        if (controller.signal.aborted) return
        toast.error('歌单加载失败')
        setLoading(false)
      }
    }
    void load()

    return () => controller.abort()
  }, [id])

  const filteredSongs = useMemo(() => {
    if (!keyword.trim()) return songs
    return songs.filter((song) =>
      matchesKeyword(
        keyword,
        song.name,
        song.al.name,
        song.ar.map((artist) => artist.name).join(' '),
      ),
    )
  }, [keyword, songs])

  if (loading) {
    return (
      <div className="px-8 pt-8">
        <div className="flex gap-6">
          <Skeleton className="h-[208px] w-[208px] rounded-[18px]" />
          <div className="flex-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="mt-3 h-8 w-[42%] rounded-full" />
            <Skeleton className="mt-4 h-3 w-[260px] rounded-full" />
            <Skeleton className="mt-3 h-3 w-[70%] rounded-full" />
            <Skeleton className="mt-5 h-9 w-[240px] rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-8 h-[300px] w-full rounded-[18px]" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          title="歌单不存在或无法访问"
          action={
            <Button
              variant="primary"
              size="sm"
              className="rounded-full"
              onClick={() => void navigate({ to: '/songlists' })}
            >
              返回推荐歌单
            </Button>
          }
        />
      </div>
    )
  }

  const isOwner = Boolean(profile && profile.userId === detail.creator?.userId)

  const handleSubscribe = async () => {
    if (!isLogin) {
      toast.warning('请先登录')
      openLogin()
      return
    }
    setSubscribing(true)
    const subscribe = !detail.subscribed
    try {
      const res = await updatePlaylistSubscribe({ id: detail.id, t: subscribe ? 1 : 2 })
      if (res.code !== 200) {
        toast.error(subscribe ? '收藏失败' : '取消收藏失败')
        return
      }
      setDetail({
        ...detail,
        subscribed: subscribe,
        subscribedCount: Math.max(0, (detail.subscribedCount ?? 0) + (subscribe ? 1 : -1)),
      })
      if (profile?.userId) await loadPlaylists(profile.userId)
      toast.success(subscribe ? '收藏成功' : '已取消收藏')
    } catch {
      toast.error('操作失败')
    } finally {
      setSubscribing(false)
    }
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('链接已复制')
    } catch {
      toast.warning('复制链接失败')
    }
  }

  return (
    <div className="px-8 pb-16 pt-7">
      <div className="flex gap-6">
        <ImageWithFallback
          src={detail.coverImgUrl}
          alt={detail.name}
          rounded="rounded-[18px]"
          className="artwork-shadow h-[208px] w-[208px] shrink-0"
          resize="400y400"
          priority
        />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-accent/8 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            歌单
          </span>
          <div className="mt-2.5 flex items-center gap-2.5">
            <h1 className="headline-lg line-clamp-2 text-[28px]">{detail.name}</h1>
            {isOwner ? (
              <button
                type="button"
                aria-label="编辑歌单"
                onClick={() =>
                  void navigate({
                    to: '/songlists/$id/edit',
                    params: { id: String(detail.id) },
                  })
                }
                className="pressable rounded-full p-1.5 text-black/35 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px] text-black/40">
            <div className="flex items-center gap-1.5">
              <Avatar
                src={detail.creator?.avatarUrl}
                alt={detail.creator?.nickname}
                size="xs"
              />
              <span className="font-medium text-accent">{detail.creator?.nickname}</span>
            </div>
            {detail.createTime ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatDate(detail.createTime)} 创建
              </span>
            ) : null}
            <span>{detail.trackCount} 首歌曲</span>
            <span>{formatNumber(detail.playCount)} 次播放</span>
          </div>

          {detail.tags?.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-black/35">标签</span>
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-black/8 px-2 py-0.5 text-[11px] text-black/50"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {detail.description ? (
            <div className="mt-2.5 max-w-[760px]">
              <p
                className={cn(
                  'whitespace-pre-wrap text-[11.5px] leading-relaxed text-black/40',
                  !descExpanded && 'line-clamp-2',
                )}
              >
                {detail.description}
              </p>
              {detail.description.length > 120 ? (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-accent"
                  onClick={() => setDescExpanded((value) => !value)}
                >
                  {descExpanded ? '收起' : '展开'}
                </button>
              ) : null}
            </div>
          ) : isOwner ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-accent"
              onClick={() =>
                void navigate({
                  to: '/songlists/$id/edit',
                  params: { id: String(detail.id) },
                })
              }
            >
              添加简介
            </button>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PlayAllButton songs={songs} playlistId={String(detail.id)} />
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              loading={subscribing}
              disabled={isOwner}
              onClick={() => void handleSubscribe()}
            >
              {detail.subscribed ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Star className="mr-1.5 h-3.5 w-3.5" />
              )}
              {detail.subscribed ? '已收藏' : '收藏'}
              <span className="ml-1 text-black/30">
                {formatNumber(detail.subscribedCount ?? 0)}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              onClick={() => void handleShare()}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              分享
              <span className="ml-1 text-black/30">{formatNumber(detail.shareCount ?? 0)}</span>
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-7">
        <div className="sticky top-0 z-20 -mx-8 flex items-center justify-between gap-4 border-b border-black/8 bg-white/90 px-8 py-2 backdrop-blur-xl">
          <TabsList>
            <TabsTrigger value="songs">
              歌曲列表
              <span className="ml-1 text-[11px] text-black/30">{songs.length}</span>
            </TabsTrigger>
            <TabsTrigger value="comments">
              评论
              <span className="ml-1 text-[11px] text-black/30">热议</span>
            </TabsTrigger>
          </TabsList>
          {tab === 'songs' ? (
            <Input.Search
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索歌单歌曲"
              size="sm"
              className="w-[190px] rounded-full text-[12px]"
            />
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          <SongTable
            songs={filteredSongs}
            playlistId={String(detail.id)}
            emptyText={keyword ? '没有匹配的歌曲' : '歌单暂时没有歌曲'}
          />
        </TabsContent>

        <TabsContent value="comments" className="mt-6">
          <CommentSection type={2} resourceId={Number(detail.id)} title="听友评论" />
        </TabsContent>
      </Tabs>

      {detail.isMyLike ? (
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-black/30">
          <Heart className="h-3 w-3 text-[#ff2d55]" />
          这是你的「我喜欢的音乐」
        </p>
      ) : null}
    </div>
  )
}
