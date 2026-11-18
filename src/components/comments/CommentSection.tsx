import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  CornerDownRight,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Pause,
  Play,
  Send,
} from 'lucide-react'
import { Avatar, Button, Modal, Textarea } from '@pikoloo/darwin-ui'
import {
  fetchMusicComments,
  fetchMvComments,
  fetchPlaylistComments,
  likeComment,
  sendComment,
} from '../../api'
import { useUserStore } from '../../store/user'
import { usePlayerStore } from '../../store/player'
import { toast } from '../../lib/toast'
import { getAudio } from '../../lib/audio'
import { apiUrl } from '../../lib/http'
import { formatDate, formatDuration, getArrLast } from '../../lib/format'
import { cn } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import type { Comment, CommentResponse } from '../../types'

interface CommentSectionProps {
  type: 0 | 1 | 2
  resourceId: number
  title?: string
  showComposer?: boolean
}

const VOICE_BARS = [
  7, 13, 19, 11, 23, 16, 9, 18, 25, 14, 8, 20, 12, 22, 10, 17, 24, 13, 7,
  19, 11, 21, 15, 9,
]

const VOICE_PLACEHOLDER = /^(?:\[?语音\]?|\[?发布了语音)/

function commentVoiceUrl(comment: Comment) {
  const url = comment.contentResource?.url
  return url ? apiUrl('/audio/proxy', { url }) : ''
}

function isVoicePlaceholder(comment: Comment) {
  return VOICE_PLACEHOLDER.test(comment.content.trim())
}

let activeVoiceAudio: HTMLAudioElement | null = null

function CommentVoice({
  url,
  duration,
}: {
  url: string
  duration?: number
}) {
  const { i18n } = useLingui()
  const playerPlaying = usePlayerStore((state) => state.playing)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(duration ?? 0)
  const [failed, setFailed] = useState(false)
  const failedOnceRef = useRef(false)

  const fail = () => {
    setFailed(true)
    setLoading(false)
    setPlaying(false)
    if (!failedOnceRef.current) {
      failedOnceRef.current = true
      toast.error(i18n._(msg`语音加载失败`))
    }
    if (activeVoiceAudio === audioRef.current) activeVoiceAudio = null
  }

  useEffect(
    () => () => {
      const audio = audioRef.current
      if (!audio) return
      audio.pause()
      if (activeVoiceAudio === audio) activeVoiceAudio = null
      audio.onplay = null
      audio.onpause = null
      audio.ontimeupdate = null
      audio.onloadedmetadata = null
      audio.onended = null
      audio.onerror = null
      audioRef.current = null
    },
    [],
  )

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current
    const audio = new Audio(url)
    audio.preload = 'metadata'
    audio.onplay = () => setPlaying(true)
    audio.onpause = () => setPlaying(false)
    audio.ontimeupdate = () => setCurrent(audio.currentTime)
    audio.onloadedmetadata = () =>
      setTotal(Number.isFinite(audio.duration) ? audio.duration : (duration ?? 0))
    audio.onended = () => {
      setPlaying(false)
      setCurrent(0)
      audio.currentTime = 0
      if (activeVoiceAudio === audio) activeVoiceAudio = null
    }
    audio.onerror = fail
    audioRef.current = audio
    return audio
  }

  // Starting the music player owns the audio output again. Pause any voice
  // comment immediately instead of letting both play over each other.
  useEffect(() => {
    if (!playerPlaying) return
    const audio = audioRef.current
    if (!audio || audio.paused) return
    audio.pause()
    if (activeVoiceAudio === audio) activeVoiceAudio = null
    setPlaying(false)
  }, [playerPlaying])

  const toggle = () => {
    if (loading) return
    if (failed) {
      failedOnceRef.current = false
      setFailed(false)
      audioRef.current = null
    }
    const audio = ensureAudio()
    if (!audio.paused) {
      audio.pause()
      if (activeVoiceAudio === audio) activeVoiceAudio = null
      setPlaying(false)
      return
    }
    if (activeVoiceAudio && activeVoiceAudio !== audio) {
      activeVoiceAudio.pause()
    }
    // A voice comment is its own listening moment: pause the song first.
    getAudio()?.pause()
    usePlayerStore.getState().setPlaying(false)
    activeVoiceAudio = audio
    setLoading(true)
    void audio
      .play()
      .then(() => {
        setPlaying(true)
        setLoading(false)
      })
      .catch(fail)
  }

  const seekVoice = (clientX: number, element: HTMLElement) => {
    const audio = ensureAudio()
    const seconds = total || duration || 0
    if (!seconds) return
    const rect = element.getBoundingClientRect()
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)),
    )
    audio.currentTime = ratio * seconds
    setCurrent(audio.currentTime)
  }

  const seekBy = (delta: number) => {
    const audio = ensureAudio()
    const seconds = total || duration || 0
    if (!seconds) return
    audio.currentTime = Math.min(
      seconds,
      Math.max(0, audio.currentTime + delta),
    )
    setCurrent(audio.currentTime)
  }

  const progress = total > 0 ? Math.min(1, current / total) : 0

  return (
    <div className="mt-2 flex h-9 max-w-[310px] items-center gap-2 rounded-[10px] bg-black/5 px-2 text-black/45">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-label={
          failed
            ? i18n._(msg`语音加载失败`)
            : playing
              ? i18n._(msg`暂停语音`)
              : i18n._(msg`播放语音`)
        }
        title={
          failed
            ? i18n._(msg`语音加载失败`)
            : playing
              ? i18n._(msg`暂停语音`)
              : i18n._(msg`播放语音`)
        }
        className="pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent disabled:opacity-40"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : playing ? (
          <Pause className="h-3 w-3 fill-current" />
        ) : (
          <Play className="ml-0.5 h-3 w-3 fill-current" />
        )}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={i18n._(msg`语音播放进度`)}
        aria-valuemin={0}
        aria-valuemax={Math.round(total || duration || 0)}
        aria-valuenow={Math.round(current)}
        onClick={(event) => seekVoice(event.clientX, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            seekBy(-5)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            seekBy(5)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            const audio = ensureAudio()
            const seconds = total || duration || 0
            if (!seconds) return
            audio.currentTime = event.key === 'Home' ? 0 : seconds
            setCurrent(audio.currentTime)
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[2px] py-1 outline-none focus-visible:rounded focus-visible:ring-1 focus-visible:ring-accent/50"
      >
        {VOICE_BARS.map((height, index) => (
          <span
            key={index}
            className={cn(
              'min-w-px flex-1 rounded-full bg-current',
              index / VOICE_BARS.length <= progress
                ? 'opacity-80'
                : 'opacity-25',
            )}
            style={{ height }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-black/30">
        {formatDuration((total || duration || 0) * 1000)}
      </span>
    </div>
  )
}

const PAGE_SIZE = 20
const COMMENT_CACHE_TTL = 2 * 60_000
const MAX_COMMENT_CACHES = 24

interface CommentCacheEntry {
  data: CommentResponse
  serverCount: number
  updatedAt: number
}

// Tabs unmount their inactive content in several screens (playlist comments and
// the immersive player). Keep the last page in memory so toggling tabs does not
// refetch and flash a loading state each time.
const commentCache = new Map<string, CommentCacheEntry>()
// Coalesce the first-page request across rapid unmount/remount cycles. Tab
// switching must not cancel and immediately restart the same network call.
const commentRequests = new Map<string, Promise<CommentResponse>>()

type CommentFetcher = typeof fetchMusicComments

function fetchFirstCommentPage(
  key: string,
  fetcher: CommentFetcher,
  resourceId: number,
) {
  const pending = commentRequests.get(key)
  if (pending) return pending
  const request = fetcher({
    id: resourceId,
    limit: PAGE_SIZE,
    offset: 0,
  }).finally(() => {
    commentRequests.delete(key)
  })
  commentRequests.set(key, request)
  return request
}

function commentCacheKey(type: CommentSectionProps['type'], resourceId: number) {
  return `${type}:${resourceId}`
}

const commentTotals = new Map<string, number>()
const commentTotalRequests = new Map<string, Promise<number>>()

function rememberComments(
  key: string,
  data: CommentResponse,
  serverCount: number,
) {
  commentCache.set(key, {
    data,
    serverCount,
    updatedAt: Date.now(),
  })
  commentTotals.set(key, data.total ?? 0)
  if (commentCache.size > MAX_COMMENT_CACHES) {
    commentCache.delete(commentCache.keys().next().value as string)
  }
}

/** Lightweight total for tab badges; shared with the full comment list. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCommentTotal(
  type: CommentSectionProps['type'],
  resourceId: number,
  enabled = true,
) {
  const key = commentCacheKey(type, resourceId)
  const [total, setTotal] = useState<number | null>(() => {
    if (commentTotals.has(key)) return commentTotals.get(key) ?? null
    return commentCache.get(key)?.data.total ?? null
  })

  useEffect(() => {
    let active = true
    if (!enabled || resourceId <= 0) return
    const cached = commentTotals.get(key) ?? commentCache.get(key)?.data.total
    if (cached !== undefined) {
      setTotal(cached)
      return () => {
        active = false
      }
    }
    setTotal(null)
    const fetcher =
      type === 0
        ? fetchMusicComments
        : type === 1
          ? fetchMvComments
          : fetchPlaylistComments
    let request = commentTotalRequests.get(key)
    if (!request) {
      request = fetcher({ id: resourceId, limit: 1, offset: 0 })
        .then((response) => {
          const next = response.total ?? 0
          commentTotals.set(key, next)
          return next
        })
        .finally(() => {
          commentTotalRequests.delete(key)
        })
      commentTotalRequests.set(key, request)
    }
    void request
      .then((next) => {
        if (active) setTotal(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [enabled, key, resourceId, type])

  return total
}

export function CommentSection({
  type,
  resourceId,
  title,
  showComposer = true,
}: CommentSectionProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const sectionTitle = title ?? i18n._(msg`评论`)
  const key = commentCacheKey(type, resourceId)
  const initial = commentCache.get(key)
  const [data, setData] = useState<CommentResponse>(
    () => initial?.data ?? { total: 0, comments: [] },
  )
  const [loading, setLoading] = useState(() => !initial)
  const [loadingMore, setLoadingMore] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const requestIdRef = useRef(0)
  // Offset is tracked separately from the local list length: a posted comment
  // is prepended locally and must not shift the next server page.
  const serverCountRef = useRef(initial?.serverCount ?? 0)
  const loadedRef = useRef(Boolean(initial))
  const isLogin = useUserStore((state) => state.isLogin)

  const fetcher =
    type === 0 ? fetchMusicComments : type === 1 ? fetchMvComments : fetchPlaylistComments

  const fetchPage = async (offset: number, before?: number, signal?: AbortSignal) => {
    return fetcher({ id: resourceId, limit: PAGE_SIZE, offset, before }, signal)
  }

  // Persist local mutations (new comment, like, reply) without extending the
  // server cache TTL; only a successful network fetch should do that.
  useEffect(() => {
    if (!loadedRef.current) return
    const current = commentCache.get(key)
    commentCache.set(key, {
      data,
      serverCount: serverCountRef.current,
      updatedAt: current?.updatedAt ?? Date.now(),
    })
  }, [data, key])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const cached = commentCache.get(key)
    // An empty cached page can be a transient API result (or the first page
    // arrived before the resource id settled). Never let it suppress the next
    // song's request for the full two-minute TTL.
    const hasContent = Boolean(
      cached &&
        ((cached.data.total ?? 0) > 0 ||
          (cached.data.comments?.length ?? 0) > 0),
    )
    const fresh =
      cached &&
      hasContent &&
      Date.now() - cached.updatedAt < COMMENT_CACHE_TTL
    setLoadingMore(false)
    if (cached && hasContent) {
      // Hydrate immediately, even if slightly stale; a stale entry refreshes
      // silently below without replacing the list with a spinner.
      setData(cached.data)
      serverCountRef.current = cached.serverCount
      loadedRef.current = true
      setLoading(false)
      if (fresh) return
    } else {
      setLoading(true)
      setData({ total: 0, comments: [] })
      serverCountRef.current = 0
      loadedRef.current = false
    }

    fetchFirstCommentPage(key, fetcher, resourceId)
      .then((response) => {
        if (requestIdRef.current !== requestId) return
        const comments = response.comments ?? []
        const next: CommentResponse = {
          total: response.total ?? 0,
          hotComments: response.hotComments ?? [],
          comments,
        }
        serverCountRef.current = comments.length
        loadedRef.current = true
        rememberComments(key, next, comments.length)
        setData(next)
      })
      .catch(() => {
        if (requestIdRef.current === requestId && !hasContent) {
          toast.error(i18n._(msg`评论加载失败`))
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, resourceId])

  const handleLoadMore = async () => {
    if (loadingMore) return
    // Capture the page identity: the resource may change while the request is
    // in flight, and its response must not be appended to the new list.
    const requestId = requestIdRef.current
    const offset = serverCountRef.current
    const last = getArrLast(data.comments)
    const before = data.total > 5000 && last ? last.time : undefined
    setLoadingMore(true)
    try {
      const response = await fetchPage(offset, before)
      if (requestIdRef.current !== requestId) return
      const fetched = response.comments ?? []
      serverCountRef.current = offset + fetched.length
      setData((prev) => {
        const seen = new Set(prev.comments.map((comment) => comment.commentId))
        const additions = fetched.filter((comment) => !seen.has(comment.commentId))
        return {
          ...prev,
          total: response.total ?? prev.total,
          comments: [...prev.comments, ...additions],
        }
      })
    } catch {
      if (requestIdRef.current === requestId)
        toast.error(i18n._(msg`加载更多评论失败`))
    } finally {
      setLoadingMore(false)
    }
  }

  const submitComment = async (params: {
    t: number
    content: string
    commentId?: number
  }) => {
    const requestId = requestIdRef.current
    const res = await sendComment({
      t: params.t,
      type,
      id: resourceId,
      content: params.content,
      commentId: params.commentId,
    })
    // The user may have switched to another song/MV while posting; never apply
    // the response to the new resource's list.
    if (requestIdRef.current !== requestId) return
    if (res.code !== 200 || !res.comment) {
      throw new Error(i18n._(msg`评论失败`))
    }
    const comment = { ...res.comment, beReplied: res.comment.beReplied ?? [] }
    if (comment.beRepliedUser && !comment.beReplied.length) {
      comment.beReplied = [{ ...comment, user: comment.beRepliedUser, beReplied: [] }]
    }
    setData((prev) => ({
      ...prev,
      total: prev.total + 1,
      comments: [comment, ...prev.comments],
    }))
    toast.success(i18n._(msg`评论成功`))
  }

  const handleSubmit = async () => {
    if (!isLogin) {
      toast.warning(i18n._(msg`请先登录`))
      return
    }
    if (!content.trim()) {
      toast.warning(i18n._(msg`评论不能为空`))
      return
    }
    setSubmitting(true)
    try {
      await submitComment({ t: 1, content: content.trim() })
      setContent('')
    } catch {
      toast.error(i18n._(msg`评论失败`))
    } finally {
      setSubmitting(false)
    }
  }

  const handleReply = async () => {
    if (!replyTarget) return
    if (!replyContent.trim()) {
      toast.warning(i18n._(msg`回复内容不能为空`))
      return
    }
    setReplySubmitting(true)
    try {
      await submitComment({
        t: 2,
        content: replyContent.trim(),
        commentId: replyTarget.commentId,
      })
      setReplyContent('')
      setReplyTarget(null)
    } catch {
      toast.error(i18n._(msg`回复失败`))
    } finally {
      setReplySubmitting(false)
    }
  }

  const handleLike = async (comment: Comment, hot: boolean) => {
    if (!isLogin) {
      toast.warning(i18n._(msg`请先登录`))
      return
    }
    const nextLiked = !comment.liked
    const requestId = requestIdRef.current
    try {
      const res = await likeComment({
        t: nextLiked ? 1 : 0,
        cid: comment.commentId,
        type,
        id: resourceId,
      })
      if (requestIdRef.current !== requestId) return
      if (res.code !== 200) {
        toast.error(i18n._(msg`操作失败`))
        return
      }
      setData((prev) => ({
        ...prev,
        hotComments: hot
          ? prev.hotComments?.map((item) =>
              item.commentId === comment.commentId
                ? {
                    ...item,
                    liked: nextLiked,
                    likedCount: item.likedCount + (nextLiked ? 1 : -1),
                  }
                : item,
            )
          : prev.hotComments,
        comments: hot
          ? prev.comments
          : prev.comments.map((item) =>
              item.commentId === comment.commentId
                ? {
                    ...item,
                    liked: nextLiked,
                    likedCount: item.likedCount + (nextLiked ? 1 : -1),
                  }
                : item,
            ),
      }))
    } catch {
      if (requestIdRef.current === requestId)
        toast.error(i18n._(msg`操作失败`))
    }
  }

  const openUser = (userId?: number) => {
    if (!userId) return
    void navigate({ to: '/users/$id', params: { id: String(userId) } })
  }

  const renderList = (list: Comment[], hot: boolean, heading?: string) => {
    if (!list.length) return null
    return (
      <div className="mt-6">
        {heading ? (
          <p className="mb-2 text-[12px] font-semibold text-black/65">
            {heading}
            <span className="ml-1.5 font-normal text-black/30">({list.length})</span>
          </p>
        ) : null}
        <div className="comment-list">
          {list.map((comment) => (
            <div key={comment.commentId} className="flex gap-3 py-4">
              <button
                type="button"
                onClick={() => openUser(comment.user?.userId)}
                disabled={!comment.user?.userId}
                aria-label={i18n._(msg`查看 ${comment.user?.nickname ?? ''} 的主页`)}
                className="pressable h-fit shrink-0 rounded-full disabled:cursor-default"
              >
                <Avatar
                  src={
                    resizedImageUrl(comment.user?.avatarUrl, '100y100') ??
                    comment.user?.avatarUrl
                  }
                  alt={comment.user?.nickname}
                  fallback={comment.user?.nickname?.slice(0, 1)}
                  size="sm"
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openUser(comment.user?.userId)}
                    disabled={!comment.user?.userId}
                    className="text-left text-[12px] font-medium text-accent hover:underline disabled:cursor-default disabled:no-underline"
                  >
                    {comment.user?.nickname}
                  </button>
                  {hot ? (
                    <span className="rounded bg-[#ff9500]/10 px-1 text-[8.5px] text-[#b36b00]">
                      <Trans>热门</Trans>
                    </span>
                  ) : null}
                </div>
                {commentVoiceUrl(comment) && isVoicePlaceholder(comment) ? null : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-black/75">
                    {comment.content}
                  </p>
                )}
                {commentVoiceUrl(comment) ? (
                  <CommentVoice
                    url={commentVoiceUrl(comment)}
                    duration={comment.contentResource?.duration}
                  />
                ) : null}
                {comment.beReplied?.[0] ? (
                  <div className="mt-2 rounded-[10px] bg-black/4 px-3 py-2 text-[11.5px] leading-relaxed text-black/55">
                    {comment.beReplied[0].user?.userId ? (
                      <button
                        type="button"
                        onClick={() =>
                          openUser(comment.beReplied[0].user?.userId)
                        }
                        className="text-accent hover:underline"
                      >
                        @{comment.beReplied[0].user?.nickname}：
                      </button>
                    ) : (
                      <span className="text-accent">
                        @{comment.beReplied[0].user?.nickname}：
                      </span>
                    )}
                    {comment.beReplied[0].content}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-4 text-[11px] text-black/30">
                  <span>{formatDate(comment.time, true)}</span>
                  {comment.ipLocation?.location ? (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />
                      {comment.ipLocation.location}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleLike(comment, hot)}
                    className={cn(
                      'pressable flex items-center gap-1 transition-colors',
                      comment.liked ? 'text-[#ff2d55]' : 'hover:text-black/60',
                    )}
                  >
                    <Heart
                      className={cn('h-3 w-3', comment.liked ? 'fill-current' : '')}
                    />
                    {comment.likedCount}
                  </button>
                  <button
                    type="button"
                    className="pressable flex items-center gap-1 hover:text-black/60"
                    onClick={() => {
                      if (!isLogin) {
                        toast.warning(i18n._(msg`请先登录`))
                        return
                      }
                      setReplyTarget(comment)
                    }}
                  >
                    <MessageCircle className="h-3 w-3" />
                    <Trans>回复</Trans>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="headline-md text-[17px]">{sectionTitle}</h3>
        <span className="text-[11.5px] text-black/35">
          {data.total ? <Trans>{data.total} 条</Trans> : null}
        </span>
      </div>

      {showComposer && (
        <div className="comment-composer mt-4 rounded-[18px] border p-3">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              isLogin
                ? i18n._(msg`说点什么…`)
                : i18n._(msg`登录后参与评论`)
            }
            maxLength={140}
            resize="none"
            className="min-h-[76px] border-0 bg-transparent text-[12.5px] focus:ring-0"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-black/25">{content.length}/140</span>
            <Button
              size="sm"
              variant="primary"
              loading={submitting}
              disabled={!content.trim() || submitting}
              className="rounded-full px-4"
              onClick={() => void handleSubmit()}
            >
              <Send className="mr-1.5 h-3 w-3" />
              <Trans>评论</Trans>
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-4 w-4 animate-spin text-black/30" />
        </div>
      ) : (
        <>
          {renderList(
            data.hotComments ?? [],
            true,
            i18n._(msg`精彩评论`),
          )}
          {renderList(data.comments, false, i18n._(msg`最新评论`))}
          {!data.comments.length && !data.hotComments?.length ? (
            <p className="py-10 text-center text-[12px] text-black/35">
              <Trans>还没有评论，快来抢沙发～</Trans>
            </p>
          ) : null}
          {data.comments.length > 0 && data.comments.length < data.total ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                className="rounded-full px-4 text-[11.5px]  border-none"
                onClick={() => void handleLoadMore()}
              >
                <CornerDownRight className="mr-1.5 h-3 w-3" />
                <Trans>加载更多</Trans>
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        isOpen={Boolean(replyTarget)}
        onClose={() => setReplyTarget(null)}
        title={i18n._(msg`回复 ${replyTarget?.user?.nickname ?? ''}`)}
        size="sm"
        glass
      >
        <div className="pb-2">
          <Textarea
            value={replyContent}
            onChange={(event) => setReplyContent(event.target.value)}
            maxLength={140}
            placeholder={i18n._(msg`回复内容`)}
            resize="none"
            className="min-h-[92px] text-[12.5px]"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="secondary" className="rounded-full" onClick={() => setReplyTarget(null)}>
              <Trans>取消</Trans>
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={replySubmitting}
              className="rounded-full px-4"
              onClick={() => void handleReply()}
            >
              <Trans>回复</Trans>
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
