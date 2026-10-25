import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ImagePlus, Pencil, Save } from 'lucide-react'
import { Button, Input, Skeleton, Textarea } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import {
  fetchPlaylistDetail,
  fetchPlaylistTags,
  updatePlaylistCover,
  updatePlaylistInfo,
} from '../../api'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { getImageSize } from '../../lib/image'
import { toast } from '../../lib/toast'
import type { Playlist } from '../../types'

export const Route = createFileRoute('/songlists/$id/edit')({
  component: EditPlaylistPage,
})

function EditPlaylistPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const openLogin = useUiStore((state) => state.openLogin)
  const fileRef = useRef<HTMLInputElement>(null)

  const [detail, setDetail] = useState<Playlist | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [cover, setCover] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetchPlaylistTags()
      .then((list) => setAllTags(list.map((item) => item.name)))
      .catch(() => undefined)
    let cancelled = false
    setLoading(true)
    fetchPlaylistDetail(id)
      .then((playlist) => {
        if (cancelled) return
        setDetail(playlist)
        setName(playlist.name)
        setDesc(playlist.description ?? '')
        setTags(playlist.tags ?? [])
        setCover(playlist.coverImgUrl)
      })
      .catch(() => {
        if (!cancelled) toast.error('歌单加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!isLogin) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          title="登录后才能编辑歌单"
          action={
            <Button variant="primary" size="sm" className="rounded-full" onClick={openLogin}>
              扫码登录
            </Button>
          }
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-8 pt-8">
        <Skeleton className="h-5 w-28 rounded-full" />
        <div className="mt-5 flex gap-5">
          <Skeleton className="h-[180px] w-[180px] rounded-[14px]" />
          <Skeleton className="h-[220px] flex-1 rounded-[14px]" />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="px-8 pt-10">
        <EmptyState title="无法编辑该歌单" />
      </div>
    )
  }

  const isOwner = Boolean(profile && profile.userId === detail.creator?.userId)

  if (!isOwner) {
    return (
      <div className="px-8 pt-10">
        <EmptyState title="只能编辑自己创建的歌单" />
      </div>
    )
  }

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      if (prev.includes(tag)) return prev.filter((item) => item !== tag)
      if (prev.length >= 3) {
        toast.warning('最多可选三个标签')
        return prev
      }
      return [...prev, tag]
    })
  }

  const handleCoverPick = () => fileRef.current?.click()

  const handleCoverChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const size = await getImageSize(file)
      const res = await updatePlaylistCover(file, size.width, id)
      if (res.code === 200 && res.data?.url) {
        setCover(res.data.url)
        toast.success('封面更新成功')
      } else {
        toast.error('封面上传失败')
      }
    } catch {
      toast.error('封面上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.warning('歌单名不能为空')
      return
    }
    setSaving(true)
    try {
      const res = await updatePlaylistInfo({
        id,
        name: name.trim(),
        tags: tags.join(';'),
        desc,
      })
      if (res.code === 200) {
        toast.success('歌单信息已保存')
        void navigate({ to: '/songlists/$id', params: { id } })
      } else {
        toast.error('保存失败')
      }
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-16 pt-5">
      <button
        type="button"
        onClick={() => void navigate({ to: '/songlists/$id', params: { id } })}
        className="pressable flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/70"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回歌单
      </button>

      <div className="mt-4">
        <h1 className="headline-lg flex items-center gap-2">
          <Pencil className="h-5 w-5 text-[#0066cc]" />
          编辑歌单信息
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">修改歌单名称、标签、简介与封面</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_210px]">
        <div className="apple-card space-y-5 p-6">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-black/40">歌单名</p>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入歌单名"
              maxLength={40}
              className="h-9 text-[12.5px]"
            />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-black/40">
              标签
              <span className="ml-1 font-normal text-black/25">（最多 3 个）</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="rounded-full bg-[#0066cc] px-2.5 py-1 text-[11px] text-white"
                >
                  {tag} ×
                </button>
              ))}
            </div>
            <div className="mt-2 max-h-[130px] overflow-y-auto rounded-[10px] border border-black/6 p-2">
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2.5 py-1 text-[10.5px] transition-colors ${
                      tags.includes(tag)
                        ? 'bg-[#0066cc]/10 text-[#0066cc]'
                        : 'bg-[#f5f5f7] text-black/45 hover:bg-[#ececf0] hover:text-black/70'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-black/40">简介</p>
            <Textarea
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
              placeholder="介绍一下这个歌单"
              maxLength={1000}
              resize="none"
              className="min-h-[120px] text-[12.5px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-black/6 pt-4">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full text-[12px]"
              onClick={() => void navigate({ to: '/songlists/$id', params: { id } })}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="rounded-full px-4 text-[12px]"
              loading={saving}
              onClick={() => void handleSave()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存
            </Button>
          </div>
        </div>

        <div className="apple-card flex flex-col items-center self-start p-5">
          <ImageWithFallback
            src={cover}
            alt={name}
            rounded="rounded-[12px]"
            className="aspect-square w-full"
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-4 rounded-full text-[11px]"
            loading={uploading}
            onClick={handleCoverPick}
          >
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
            修改封面
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleCoverChange(event)}
          />
        </div>
      </div>
    </div>
  )
}
