import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import {
  CalendarCheck,
  ChevronDown,
  LogOut,
  Settings2,
  UserRound,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@pikoloo/darwin-ui'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'

export function UserMenu() {
  const navigate = useNavigate()
  const openLogin = useUiStore((state) => state.openLogin)
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const pcSign = useUserStore((state) => state.pcSign)
  const level = useUserStore((state) => state.level)
  const signIn = useUserStore((state) => state.signIn)
  const logout = useUserStore((state) => state.logout)
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)

  if (!isLogin || !profile) {
    return (
      <button
        type="button"
        onClick={openLogin}
        className="pressable flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        <UserRound className="h-3.5 w-3.5" />
        <Trans>登录</Trans>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pressable flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-black/5"
        >
          <Avatar src={profile.avatarUrl} alt={profile.nickname} size="xs" />
          <span className="max-w-[92px] truncate text-[12px] font-medium text-black/75">
            {profile.nickname}
          </span>
          <ChevronDown className="h-3 w-3 text-black/35" />
        </button>
      </PopoverTrigger>
      {/* darwin-ui's motion animation overrides the translateX(-100%) used by
          align="end", so shift the fixed-width panel left with a margin. */}
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        glass
        className="user-menu-popover p-0"
      >
        <div className="p-4">
          <div className="flex items-center gap-3">
            <Avatar src={profile.avatarUrl} alt={profile.nickname} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-black/85">
                {profile.nickname}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant="secondary" className="rounded-full text-[11px]">
                  Lv.{level || 1}
                </Badge>
                {profile.vipType ? (
                  <Badge variant="warning" className="rounded-full text-[11px]">
                    VIP
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 rounded-[14px] bg-black/4 py-2.5">
            {[
              { label: i18n._(msg`动态`), value: profile.eventCount ?? 0 },
              { label: i18n._(msg`关注`), value: profile.follows ?? 0 },
              { label: i18n._(msg`粉丝`), value: profile.followeds ?? 0 },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-[13px] font-semibold text-black/80">{item.value}</p>
                <p className="mt-0.5 text-[11px] text-black/35">{item.label}</p>
              </div>
            ))}
          </div>

          <Button
            size="sm"
            variant={pcSign ? 'secondary' : 'primary'}
            fullWidth
            className="mt-3 rounded-full"
            disabled={pcSign}
            onClick={() => void signIn()}
          >
            <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
            {pcSign ? <Trans>今日已签到</Trans> : <Trans>签到</Trans>}
          </Button>
        </div>

        <div className="border-t border-black/8 p-1.5">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] text-black/70 transition-colors hover:bg-black/5"
            onClick={() => {
              setOpen(false)
              void navigate({ to: '/profile' })
            }}
          >
            <Settings2 className="h-4 w-4 text-black/40" />
            <Trans>个人信息设置</Trans>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] text-[#d70015] transition-colors hover:bg-[#d70015]/8"
            onClick={() => {
              setOpen(false)
              void logout()
            }}
          >
            <LogOut className="h-4 w-4" />
            <Trans>退出登录</Trans>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
