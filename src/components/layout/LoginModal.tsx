import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import {
  Button,
  Input,
  Modal,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pikoloo/darwin-ui'
import {
  fetchQrImage,
  fetchQrKey,
  fetchQrStatus,
  loginByCellphone,
  sendCaptcha,
} from '../../api'
import { toast } from '../../lib/toast'
import { useUserStore } from '../../store/user'

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type LoginMode = 'captcha' | 'qr'
type QrStatus = 800 | 801 | 802 | 803 | 0

const STATUS_TEXT: Record<number, string> = {
  800: '二维码已失效',
  801: '等待扫码',
  802: '扫码成功，请在手机上确认',
  803: '授权登录成功',
}

const PHONE_PATTERN = /^1[3-9]\d{9}$/

function responseMessage(res: { code: number; [key: string]: unknown }) {
  if (typeof res.message === 'string' && res.message) return res.message
  if (typeof res.msg === 'string' && res.msg) return res.msg
  return undefined
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const [mode, setMode] = useState<LoginMode>('captcha')
  const [phone, setPhone] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  const [qrImage, setQrImage] = useState('')
  const [status, setStatus] = useState<QrStatus>(0)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    cancelledRef.current = false
    stopTimer()
    setLoading(true)
    setQrImage('')
    setStatus(0)
    try {
      const key = await fetchQrKey()
      const image = await fetchQrImage(key)
      if (cancelledRef.current) return
      setQrImage(image)
      setLoading(false)

      const poll = async () => {
        if (cancelledRef.current) return
        try {
          const result = await fetchQrStatus(key)
          if (cancelledRef.current) return
          setStatus(result.code as QrStatus)
          if (result.code === 803) {
            toast.success('登录成功')
            await useUserStore.getState().initSession()
            onOpenChange(false)
            return
          }
          if (result.code === 800) return
          timerRef.current = window.setTimeout(poll, 1200)
        } catch {
          if (!cancelledRef.current) timerRef.current = window.setTimeout(poll, 1600)
        }
      }

      timerRef.current = window.setTimeout(poll, 1200)
    } catch {
      if (!cancelledRef.current) {
        setLoading(false)
        toast.error('获取二维码失败，请检查本地 API 服务是否启动')
      }
    }
  }, [onOpenChange, stopTimer])

  // Reset to the verification-code login every time the modal opens.
  useEffect(() => {
    if (open) return
    setMode('captcha')
    setPhone('')
    setCaptcha('')
    setCountdown(0)
    setSending(false)
    setLoggingIn(false)
    setQrImage('')
    setStatus(0)
    setLoading(false)
  }, [open])

  // Only fetch and poll the QR code while the QR tab is actually visible.
  useEffect(() => {
    if (!open || mode !== 'qr') {
      cancelledRef.current = true
      stopTimer()
      return
    }
    void start()
    return () => {
      cancelledRef.current = true
      stopTimer()
    }
  }, [open, mode, start, stopTimer])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const phoneValid = PHONE_PATTERN.test(phone)

  const handleSendCaptcha = async () => {
    if (!phoneValid) {
      toast.warning('请输入正确的 11 位手机号')
      return
    }
    if (countdown > 0 || sending) return
    setSending(true)
    try {
      const res = await sendCaptcha(phone)
      if (res.code === 200) {
        toast.success('验证码已发送，请查收短信')
        setCountdown(60)
      } else {
        toast.error(responseMessage(res) ?? '验证码发送失败')
      }
    } catch {
      toast.error('验证码发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  const handleCellphoneLogin = async () => {
    if (!phoneValid) {
      toast.warning('请输入正确的 11 位手机号')
      return
    }
    if (!captcha.trim()) {
      toast.warning('请输入验证码')
      return
    }
    if (loggingIn) return
    setLoggingIn(true)
    try {
      const res = await loginByCellphone(phone, captcha.trim())
      if (res.code === 200) {
        toast.success('登录成功')
        await useUserStore.getState().initSession()
        onOpenChange(false)
      } else {
        toast.error(responseMessage(res) ?? '登录失败，请检查手机号或验证码')
      }
    } catch {
      toast.error('登录失败，请检查手机号或验证码')
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => onOpenChange(false)} title="登录" size="sm" glass>
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as LoginMode)}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="captcha" icon={<Smartphone className="h-3.5 w-3.5" />}>
            验证码登录
          </TabsTrigger>
          <TabsTrigger value="qr" icon={<QrCode className="h-3.5 w-3.5" />}>
            扫码登录
          </TabsTrigger>
        </TabsList>

        <TabsContent value="captcha" className="mt-4">
          <form
            className="flex flex-col gap-3.5 pb-1"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCellphoneLogin()
            }}
          >
            <div>
              <p className="mb-1.5 text-[11px] text-black/40">手机号</p>
              <Input
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))
                }
                placeholder="请输入手机号"
                inputMode="numeric"
                autoComplete="tel"
                leftIcon={<Smartphone className="h-3.5 w-3.5" />}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-black/40">验证码</p>
              <div className="flex items-center gap-2">
                <Input
                  value={captcha}
                  onChange={(event) =>
                    setCaptcha(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="请输入验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  wrapperClassName="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="default"
                  className="shrink-0"
                  disabled={!phoneValid || countdown > 0 || sending}
                  loading={sending}
                  onClick={() => void handleSendCaptcha()}
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              className="mt-1"
              loading={loggingIn}
              loadingText="登录中…"
              disabled={!phoneValid || !captcha.trim() || loggingIn}
            >
              登录
            </Button>

            <p className="text-center text-[11px] leading-relaxed text-black/30">
              未注册的手机号登录后将自动创建账号
            </p>
          </form>
        </TabsContent>

        <TabsContent value="qr" className="mt-4">
          <div className="flex flex-col items-center pb-1">
            <div className="qr-surface relative flex h-[210px] w-[210px] items-center justify-center overflow-hidden rounded-[18px] border border-black/8 bg-white">
              {loading && <Loader2 className="h-7 w-7 animate-spin text-black/35" />}
              {!loading && qrImage && (
                <img src={qrImage} alt="登录二维码" className="h-[200px] w-[200px]" />
              )}
              {!loading && status === 800 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white backdrop-blur-sm">
                  <p className="text-[13px]">二维码已失效</p>
                  <Button size="sm" variant="primary" onClick={() => void start()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    刷新
                  </Button>
                </div>
              )}
            </div>

            <p className="mt-5 flex items-center gap-1.5 text-[13px] text-black/45">
              <Smartphone className="h-4 w-4" />
              <span>使用网易云音乐 App 扫码登录</span>
            </p>
            <p className="mt-1 h-4 text-[12px] text-black/35">{STATUS_TEXT[status] ?? ''}</p>

            <p className="mt-3 max-w-[260px] text-center text-[11px] leading-relaxed text-black/30">
              若二维码无法刷新，请确认本地 API 服务已在 3000 端口运行
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  )
}
