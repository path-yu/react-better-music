import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Camera, Cake, MapPin, Save, UserRound } from 'lucide-react'
import { Avatar, Button, Input, Select, Textarea } from '@pikoloo/darwin-ui'
import { EmptyState } from '../components/common/EmptyState'
import { fetchUserDetail, updateUserAvatar, updateUserInfo } from '../api'
import { useUserStore } from '../store/user'
import { useUiStore } from '../store/ui'
import { getImageSize } from '../lib/image'
import { toast } from '../lib/toast'
import { useDocumentTitle } from '../lib/title'
import regionJson from '../data/region.json'
import type { UserProfile } from '../types'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

interface RegionCity {
  label: string
  value: number
}

interface RegionGroup {
  label: string
  value: number
  provinceList?: Array<Record<string, number>>
  cityList: RegionCity[]
}

const regions = regionJson as unknown as RegionGroup[]

const yearOptions = Array.from({ length: new Date().getFullYear() - 1919 }, (_, index) => {
  const value = new Date().getFullYear() - index
  return { value: String(value), label: `${value}年` }
})
const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1}月`,
}))
const genderOptions = [
  { value: '0', label: '保密' },
  { value: '1', label: '男' },
  { value: '2', label: '女' },
]
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function daysInMonth(month: number, year: number) {
  if (month === 2) return year % 4 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function findRegionByProvince(province?: number) {
  if (!province) return regions[0]
  const direct = regions.find((region) => region.value === province)
  if (direct) return direct
  for (const region of regions) {
    if (region.provinceList?.some((item) => Object.values(item).includes(province))) return region
    if (region.cityList.some((city) => city.value === province)) return region
  }
  return regions[0]
}

function ProfilePage() {
  const { i18n } = useLingui()
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const setProfile = useUserStore((state) => state.setProfile)
  const refreshProfile = useUserStore((state) => state.refreshProfile)
  const openLogin = useUiStore((state) => state.openLogin)
  const fileRef = useRef<HTMLInputElement>(null)
  const hydratedForRef = useRef<number | null>(null)

  const [nickname, setNickname] = useState('')
  const [signature, setSignature] = useState('')
  const [gender, setGender] = useState('0')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [year, setYear] = useState('2000')
  const [month, setMonth] = useState('1')
  const [day, setDay] = useState('1')
  const [province, setProvince] = useState(String(regions[0]?.value ?? ''))
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  useDocumentTitle(i18n._(msg`个人信息`))

  useEffect(() => {
    if (!isLogin) return
    void refreshProfile()
  }, [isLogin, refreshProfile])

  useEffect(() => {
    if (!profile) return
    if (hydratedForRef.current === profile.userId) return
    hydratedForRef.current = profile.userId
    setNickname(profile.nickname ?? '')
    setSignature(profile.signature ?? '')
    setGender(String(profile.gender ?? 0))
    setAvatarUrl(profile.avatarUrl ?? '')
    const date = profile.birthday ? new Date(profile.birthday) : null
    if (date && !Number.isNaN(date.getTime())) {
      setYear(String(date.getFullYear()))
      setMonth(String(date.getMonth() + 1))
      setDay(String(date.getDate()))
    }
    const region = findRegionByProvince(profile.province)
    setProvince(String(region.value))
    const nextCity =
      region.cityList.find((item) => item.value === profile.city)?.value ??
      region.cityList[0]?.value
    setCity(String(nextCity ?? ''))
  }, [profile])

  const activeRegion = useMemo(
    () => regions.find((region) => String(region.value) === province) ?? regions[0],
    [province],
  )

  const dayOptions = useMemo(() => {
    const total = daysInMonth(Number(month), Number(year))
    return Array.from({ length: total }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1}日`,
    }))
  }, [month, year])

  const cityOptions = useMemo(
    () =>
      (activeRegion?.cityList ?? []).map((item) => ({
        value: String(item.value),
        label: item.label,
      })),
    [activeRegion],
  )

  const provinceOptions = useMemo(
    () => regions.map((region) => ({ value: String(region.value), label: region.label })),
    [],
  )

  if (!isLogin || !profile) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<UserRound className="h-6 w-6" />}
          title={i18n._(msg`登录后编辑个人信息`)}
          description="扫码登录网易云账号即可同步头像与资料"
          action={
            <Button variant="primary" size="sm" className="rounded-full" onClick={openLogin}>
              扫码登录
            </Button>
          }
        />
      </div>
    )
  }

  const hydratedProfile = profile as UserProfile

  const handleProvinceChange = (value: string) => {
    setProvince(value)
    const region = regions.find((item) => String(item.value) === value)
    setCity(String(region?.cityList[0]?.value ?? ''))
  }

  const handleDayChange = (value: string) => {
    const total = daysInMonth(Number(month), Number(year))
    setDay(Number(value) > total ? String(total) : value)
  }

  const handleAvatarPick = () => fileRef.current?.click()

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.warning(i18n._(msg`请选择图片文件`))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.warning(i18n._(msg`图片不能超过 5MB`))
      return
    }
    setUploading(true)
    try {
      const size = await getImageSize(file)
      const res = await updateUserAvatar(file, size.width)
      if (res.code === 200 && res.data?.url) {
        setAvatarUrl(res.data.url)
        setProfile({ ...hydratedProfile, avatarUrl: res.data.url })
        toast.success(i18n._(msg`头像更新成功`))
      } else {
        toast.error(i18n._(msg`头像上传失败`))
      }
    } catch {
      toast.error(i18n._(msg`头像上传失败`))
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!nickname.trim()) {
      toast.warning(i18n._(msg`昵称不能为空`))
      return
    }
    const region = regions.find((item) => String(item.value) === province)
    let provinceValue: number | string = Number(province)
    if (region?.provinceList?.length) {
      const cityName = region.cityList.find((item) => String(item.value) === city)?.label
      const entry = region.provinceList.find((item) =>
        cityName ? Object.keys(item)[0] === cityName : false,
      )
      if (entry) provinceValue = Object.values(entry)[0]
    }
    const birthday = new Date(Number(year), Number(month) - 1, Number(day)).getTime()
    setSaving(true)
    try {
      const res = await updateUserInfo({
        nickname: nickname.trim(),
        signature,
        gender: Number(gender),
        birthday,
        province: provinceValue,
        city: Number(city),
      })
      if (res.code === 200) {
        setProfile({
          ...hydratedProfile,
          nickname: nickname.trim(),
          signature,
          gender: Number(gender),
          birthday,
        })
        toast.success(i18n._(msg`个人资料已更新`))
        const detail = await fetchUserDetail(hydratedProfile.userId)
        if (detail?.profile) setProfile(detail.profile, detail.level)
      } else {
        toast.error(i18n._(msg`保存失败`))
      }
    } catch {
      toast.error(i18n._(msg`保存失败`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-16 pt-7">
      <div>
        <h1 className="headline-lg flex items-center gap-2">
          <UserRound className="h-5 w-5 text-accent" />
          个人信息
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">修改昵称、头像、性别与地区资料</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_230px]">
        <div className="apple-card space-y-5 p-6">
          <Field label="昵称">
            <Input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={i18n._(msg`请输入昵称`)}
              maxLength={24}
              className="h-9 text-[12.5px]"
            />
          </Field>

          <Field label="介绍">
            <Textarea
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={i18n._(msg`介绍一下自己`)}
              maxLength={200}
              resize="none"
              className="min-h-[84px] text-[12.5px]"
            />
          </Field>

          <Field label="性别">
            <div className="flex gap-1.5">
              {genderOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGender(option.value)}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] transition-colors ${
                    gender === option.value
                      ? 'bg-accent text-white'
                      : 'border border-black/8 bg-[#f5f5f7] text-black/50 hover:bg-[#ececf0]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="生日" icon={<Cake className="h-3.5 w-3.5 text-black/30" />}>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={year}
                onChange={(event) => setYear(event.target.value)}
                options={yearOptions}
                searchable
                className="text-[12px]"
              />
              <Select
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                options={monthOptions}
                className="text-[12px]"
              />
              <Select
                value={day}
                onChange={(event) => handleDayChange(event.target.value)}
                options={dayOptions}
                className="text-[12px]"
              />
            </div>
          </Field>

          <Field label="地区" icon={<MapPin className="h-3.5 w-3.5 text-black/30" />}>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={province}
                onChange={(event) => handleProvinceChange(event.target.value)}
                options={provinceOptions}
                searchable
                className="text-[12px]"
              />
              <Select
                value={city}
                onChange={(event) => setCity(event.target.value)}
                options={cityOptions}
                searchable
                className="text-[12px]"
              />
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2 border-t border-black/6 pt-4">
            <Button
              variant="primary"
              size="sm"
              className="rounded-full px-4 text-[12px]"
              loading={saving}
              onClick={() => void handleSave()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存修改
            </Button>
          </div>
        </div>

        <div className="apple-card flex flex-col items-center self-start p-6">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={nickname}
                className="h-[132px] w-[132px] rounded-full object-cover shadow-[0_10px_30px_-18px_rgba(0,0,0,0.5)]"
              />
            ) : (
              <Avatar size="xl" alt={nickname} fallback={nickname.slice(0, 1)} />
            )}
            <button
              type="button"
              aria-label={i18n._(msg`更换头像`)}
              onClick={handleAvatarPick}
              className="media-chip pressable absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-accent shadow-md max-md:h-10 max-md:w-10"
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-4 text-[13px] font-medium text-black/75">{nickname || '未设置昵称'}</p>
          <p className="mt-1 line-clamp-2 text-center text-[11px] text-black/35">
            {signature || '这个人很懒，什么都没写'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4 rounded-full text-[11px]"
            loading={uploading}
            onClick={handleAvatarPick}
          >
            更换头像
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFileChange(event)}
          />
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-medium text-black/40">{label}</span>
      </div>
      {children}
    </div>
  )
}
