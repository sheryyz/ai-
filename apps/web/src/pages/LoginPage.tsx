import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input, Label } from '../components/ui/input'
import { errorMessage, request } from '../lib/api'

export function LoginPage({ setupRequired, onSuccess }: { setupRequired: boolean; onSuccess: () => void }) {
  const navigate = useNavigate()
  const [registering, setRegistering] = useState(setupRequired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface-2 text-muted">
          <LockKeyhole className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {registering ? '开启你的工作区' : '欢迎回到 MorphOS'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {registering ? '创建账号，拥有独立的应用与业务数据空间。' : '登录后，继续管理你的应用与业务数据。'}
        </p>
      </div>
      <Card className="p-6">
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setError('')
            if (registering && password !== confirmation) {
              setError('两次输入的密码不一致')
              return
            }
            setBusy(true)
            try {
              await request('POST', `/api/auth/${registering ? 'register' : 'login'}`, { username, password })
              setPassword('')
              setConfirmation('')
              if (registering) navigate('/', { replace: true })
              onSuccess()
            } catch (e) {
              setError(errorMessage(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div>
            <Label htmlFor="admin-username">工作区账号</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              maxLength={64}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              placeholder="输入工作区账号"
            />
          </div>
          <div>
            <Label htmlFor="admin-password">密码</Label>
            <div className="relative">
              <Input
                id="admin-password"
                className="pr-10"
                type={visible ? 'text' : 'password'}
                autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={registering ? 12 : undefined}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                placeholder={registering ? '至少 12 个字符' : '输入密码'}
              />
              <Button
                className="absolute top-0.5 right-1"
                variant="ghost"
                size="icon"
                aria-label={visible ? '隐藏密码' : '显示密码'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          {registering ? (
            <div>
              <Label htmlFor="admin-confirmation">确认密码</Label>
              <Input
                id="admin-confirmation"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={busy}
                placeholder="再次输入密码"
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
            {registering ? '注册并创建工作区' : '登录工作区'}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full justify-center"
          disabled={busy}
          onClick={() => {
            setRegistering(!registering)
            setPassword('')
            setConfirmation('')
            setError('')
          }}
        >
          {registering ? '已有账号？登录工作区' : '没有账号？注册新工作区'}
        </Button>
      </Card>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        {registering ? '每个账号拥有独立工作区，请妥善保存密码。' : '登录自己的工作区，创建和管理应用。'}
        <br />
        报名或签到，请使用组织者分享的页面链接。
      </p>
    </main>
  )
}
