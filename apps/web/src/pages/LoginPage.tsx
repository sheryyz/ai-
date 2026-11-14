import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input, Label } from '../components/ui/input'
import { errorMessage, request } from '../lib/api'

export function LoginPage({ setupRequired, onSuccess }: { setupRequired: boolean; onSuccess: () => void }) {
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
          {setupRequired ? '开启你的工作区' : '欢迎回到 MorphOS'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {setupRequired
            ? '设置管理员账号，开始管理和演进你的应用。'
            : '登录后，继续管理你的应用与业务数据。'}
        </p>
      </div>
      <Card className="p-6">
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setError('')
            if (setupRequired && password !== confirmation) {
              setError('两次输入的密码不一致')
              return
            }
            setBusy(true)
            try {
              await request('POST', `/api/auth/${setupRequired ? 'setup' : 'login'}`, { username, password })
              setPassword('')
              setConfirmation('')
              onSuccess()
            } catch (e) {
              setError(errorMessage(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div>
            <Label htmlFor="admin-username">管理员账号</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              maxLength={64}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              placeholder="输入管理员账号"
            />
          </div>
          <div>
            <Label htmlFor="admin-password">密码</Label>
            <div className="relative">
              <Input
                id="admin-password"
                className="pr-10"
                type={visible ? 'text' : 'password'}
                autoComplete={setupRequired ? 'new-password' : 'current-password'}
                minLength={setupRequired ? 12 : undefined}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                placeholder={setupRequired ? '至少 12 个字符' : '输入密码'}
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
          {setupRequired ? (
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
            {setupRequired ? '创建账号并进入' : '登录工作区'}
          </Button>
        </form>
      </Card>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        {setupRequired ? '此账号管理本机工作区的全部应用，请妥善保存密码。' : '仅供工作区管理员使用。'}
        <br />
        报名或签到，请使用组织者分享的页面链接。
      </p>
    </main>
  )
}
