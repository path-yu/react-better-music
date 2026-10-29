import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { CornerDownRight, Heart, Loader2, MessageCircle, Send } from 'lucide-react'
import { Avatar, Button, Modal, Textarea } from '@pikoloo/darwin-ui'
import {
  fetchMusicComments,
  fetchMvComments,
  fetchPlaylistComments,
  likeComment,
  sendComment,
} from '../../api'
import { useUserStore } from '../../store/user'
import { toast } from '../../lib/toast'
import { formatDate, getArrLast } from '../../lib/format'
import { cn } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import type { Comment, CommentResponse } from '../../types'

interface CommentSectionProps {
  type: 0 | 1 | 2
  resourceId: number
  title?: string
  showComposer?: boolean
}

const PAGE_SIZE = 20

export function CommentSection({
  type,
  resourceId,
  title,
  showComposer = true,
}: CommentSectionProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const sectionTitle = title ?? i18n._(msg`评论`)
  const [data, setData] = useState<CommentResponse>({ total: 0, comments: [] })
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const requestIdRef = useRef(0)
  // Offset is tracked separately from the local list length: a posted comment
  // is prepended locally and must not shift the next server page.
  const serverCountRef = useRef(0)
  const isLogin = useUserStore((state) => state.isLogin)

  const fetcher =
    type === 0 ? fetchMusicComments : type === 1 ? fetchMvComments : fetchPlaylistComments

  const fetchPage = async (offset: number, before?: number, signal?: AbortSignal) => {
    return fetcher({ id: resourceId, limit: PAGE_SIZE, offset, before }, signal)
  }

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    setLoading(true)
    setData({ total: 0, comments: [] })
    serverCountRef.current = 0
    fetchPage(0, undefined, controller.signal)
      .then((response) => {
        if (requestIdRef.current !== requestId) return
        const comments = response.comments ?? []
        serverCountRef.current = comments.length
        setData({
          total: response.total ?? 0,
          hotComments: response.hotComments ?? [],
          comments,
        })
      })
      .catch(() => {
        if (requestIdRef.current === requestId && !controller.signal.aborted) {
          toast.error(i18n._(msg`评论加载失败`))
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId && !controller.signal.aborted) {
          setLoading(false)
        }
      })
    return () => controller.abort()
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
                <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-black/75">
                  {comment.content}
                </p>
                {comment.beReplied?.[0] ? (
                  <div className="mt-2 rounded-[10px] bg-black/4 px-3 py-2 text-[11.5px] leading-relaxed text-black/55">
                    <span className="text-accent">
                      @{comment.beReplied[0].user?.nickname}：
                    </span>
                    {comment.beReplied[0].content}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-4 text-[11px] text-black/30">
                  <span>{formatDate(comment.time, true)}</span>
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
                className="rounded-full px-4 text-[11.5px]"
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
