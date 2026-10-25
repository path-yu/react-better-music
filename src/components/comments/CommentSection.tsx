import { useEffect, useRef, useState } from 'react'
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
  title = '评论',
  showComposer = true,
}: CommentSectionProps) {
  const [data, setData] = useState<CommentResponse>({ total: 0, comments: [] })
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const requestIdRef = useRef(0)
  const isLogin = useUserStore((state) => state.isLogin)

  const fetcher =
    type === 0 ? fetchMusicComments : type === 1 ? fetchMvComments : fetchPlaylistComments

  const fetchPage = async (offset: number, before?: number) => {
    return fetcher({ id: resourceId, limit: PAGE_SIZE, offset, before })
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setData({ total: 0, comments: [] })
    fetchPage(0)
      .then((response) => {
        if (requestIdRef.current !== requestId) return
        setData({
          total: response.total ?? 0,
          hotComments: response.hotComments ?? [],
          comments: response.comments ?? [],
        })
      })
      .catch(() => {
        if (requestIdRef.current === requestId) toast.error('评论加载失败')
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, resourceId])

  const handleLoadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const offset = data.comments.length
      const last = getArrLast(data.comments)
      const before = data.total > 5000 && last ? last.time : undefined
      const response = await fetchPage(offset, before)
      setData((prev) => ({
        ...prev,
        total: response.total ?? prev.total,
        comments: [...prev.comments, ...(response.comments ?? [])],
      }))
    } catch {
      toast.error('加载更多评论失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const submitComment = async (params: {
    t: number
    content: string
    commentId?: number
  }) => {
    const res = await sendComment({
      t: params.t,
      type,
      id: resourceId,
      content: params.content,
      commentId: params.commentId,
    })
    if (res.code !== 200 || !res.comment) {
      throw new Error('评论失败')
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
    toast.success('评论成功')
  }

  const handleSubmit = async () => {
    if (!isLogin) {
      toast.warning('请先登录')
      return
    }
    if (!content.trim()) {
      toast.warning('评论不能为空')
      return
    }
    setSubmitting(true)
    try {
      await submitComment({ t: 1, content: content.trim() })
      setContent('')
    } catch {
      toast.error('评论失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReply = async () => {
    if (!replyTarget) return
    if (!replyContent.trim()) {
      toast.warning('回复内容不能为空')
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
      toast.error('回复失败')
    } finally {
      setReplySubmitting(false)
    }
  }

  const handleLike = async (comment: Comment, hot: boolean) => {
    if (!isLogin) {
      toast.warning('请先登录')
      return
    }
    const nextLiked = !comment.liked
    try {
      const res = await likeComment({
        t: nextLiked ? 1 : 0,
        cid: comment.commentId,
        type,
        id: resourceId,
      })
      if (res.code !== 200) {
        toast.error('操作失败')
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
      toast.error('操作失败')
    }
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
        <div className="divide-y divide-black/6">
          {list.map((comment) => (
            <div key={comment.commentId} className="flex gap-3 py-4">
              <Avatar
                src={comment.user?.avatarUrl}
                alt={comment.user?.nickname}
                fallback={comment.user?.nickname?.slice(0, 1)}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-[#0066cc]">
                    {comment.user?.nickname}
                  </span>
                  {hot ? (
                    <span className="rounded bg-[#ff9500]/10 px-1 text-[8.5px] text-[#b36b00]">
                      热门
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-black/75">
                  {comment.content}
                </p>
                {comment.beReplied?.[0] ? (
                  <div className="mt-2 rounded-[9px] bg-black/4 px-3 py-2 text-[11.5px] leading-relaxed text-black/55">
                    <span className="text-[#0066cc]">
                      @{comment.beReplied[0].user?.nickname}：
                    </span>
                    {comment.beReplied[0].content}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-4 text-[10.5px] text-black/30">
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
                        toast.warning('请先登录')
                        return
                      }
                      setReplyTarget(comment)
                    }}
                  >
                    <MessageCircle className="h-3 w-3" />
                    回复
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
        <h3 className="headline-md text-[17px]">{title}</h3>
        <span className="text-[11.5px] text-black/35">
          {data.total ? `${data.total} 条` : ''}
        </span>
      </div>

      {showComposer && (
        <div className="mt-4 rounded-[16px] border border-black/8 bg-white p-3">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={isLogin ? '说点什么…' : '登录后参与评论'}
            maxLength={140}
            resize="none"
            className="min-h-[76px] border-0 bg-transparent text-[12.5px] focus:ring-0"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10.5px] text-black/25">{content.length}/140</span>
            <Button
              size="sm"
              variant="primary"
              loading={submitting}
              disabled={!content.trim() || submitting}
              className="rounded-full px-4"
              onClick={() => void handleSubmit()}
            >
              <Send className="mr-1.5 h-3 w-3" />
              评论
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
          {renderList(data.hotComments ?? [], true, '精彩评论')}
          {renderList(data.comments, false, '最新评论')}
          {!data.comments.length && !data.hotComments?.length ? (
            <p className="py-10 text-center text-[12px] text-black/35">
              还没有评论，快来抢沙发～
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
                加载更多
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        isOpen={Boolean(replyTarget)}
        onClose={() => setReplyTarget(null)}
        title={`回复 ${replyTarget?.user?.nickname ?? ''}`}
        size="sm"
        glass
      >
        <div className="pb-2">
          <Textarea
            value={replyContent}
            onChange={(event) => setReplyContent(event.target.value)}
            maxLength={140}
            placeholder="回复内容"
            resize="none"
            className="min-h-[92px] text-[12.5px]"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="secondary" className="rounded-full" onClick={() => setReplyTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={replySubmitting}
              className="rounded-full px-4"
              onClick={() => void handleReply()}
            >
              回复
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
