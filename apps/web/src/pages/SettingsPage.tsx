import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { ConfirmDialog } from '../components/ui/dialog'
import { Input, Label } from '../components/ui/input'
import { errorMessage, request } from '../lib/api'

type Restored = {
  id: string
  summary: { apps: number; records: number; versions: number }
  safetyBackup: string
  command: string
}
async function checked(res: Response) {
  if (res.status === 401) window.dispatchEvent(new Event('morphos:unauthorized'))
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error?.message ?? '操作失败，请稍后重试')
  }
  return res
}
export function SettingsPage() {
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restored, setRestored] = useState<Restored | null>(null)
  const perform = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link to="/" className="text-sm text-muted hover:text-fg">
          ← 我的应用
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">工作区设置</h1>
        <p className="mt-2 text-sm text-muted">管理账号和数据副本，保持工作区可恢复。</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-add">
          {message}
        </p>
      ) : null}
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">修改密码</h2>
        <p className="text-sm text-muted">修改后所有设备都会退出登录，请使用新密码重新登录。</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void perform('password', async () => {
              if (newPassword !== confirmation) throw new Error('两次输入的新密码不一致')
              await request('POST', '/api/auth/password', { currentPassword, newPassword })
              setCurrent('')
              setNew('')
              setConfirmation('')
              window.dispatchEvent(new Event('morphos:unauthorized'))
            })
          }}
        >
          <div>
            <Label htmlFor="current-password">当前密码</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              placeholder="至少 12 个字符"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">确认新密码</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" disabled={Boolean(busy)} loading={busy === 'password'}>
            修改密码并退出
          </Button>
        </form>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">数据库备份</h2>
        <p className="text-sm leading-relaxed text-muted">
          下载完整工作区，包含应用、记录、历史版本、规则和管理员账号。备份含个人信息和账号密码哈希，请保存在可信位置，不要上传到公开仓库。模型
          API 密钥不包含在内。
        </p>
        <Button
          disabled={Boolean(busy)}
          loading={busy === 'backup'}
          onClick={() =>
            void perform('backup', async () => {
              const res = await checked(
                await fetch('/api/workspace/backup', {
                  method: 'POST',
                  headers: { 'X-MorphOS-Request': '1' },
                }),
              )
              const url = URL.createObjectURL(await res.blob())
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = 'morphos-backup.db'
              anchor.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
              setMessage('备份已生成，请确认浏览器下载已完成。')
            })
          }
        >
          下载数据库备份
        </Button>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">从备份恢复</h2>
        <p className="text-sm leading-relaxed text-muted">
          先校验并恢复为独立数据库，当前工作区保持不变。核对后停止当前服务，使用生成的命令启动恢复副本。使用备份时的管理员密码登录；旧登录会话和分享链接不会恢复生效，请重新生成分享链接。
        </p>
        <div>
          <Label htmlFor="backup-file">选择备份文件（本版本导出，最大 50 MB）</Label>
          <input
            id="backup-file"
            type="file"
            accept=".db,.sqlite,.sqlite3"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-fg"
            disabled={Boolean(busy)}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setRestored(null)
            }}
          />
        </div>
        <Button
          disabled={!file || Boolean(busy)}
          loading={busy === 'restore'}
          onClick={() => setConfirmRestore(true)}
        >
          校验并创建恢复副本
        </Button>
        {restored ? (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-4 text-sm">
            <p role="status">
              恢复副本已创建：{restored.summary.apps} 个应用、{restored.summary.records} 条记录、
              {restored.summary.versions} 个历史版本。
            </p>
            <p>当前工作区尚未切换。停止当前服务后，在项目目录执行：</p>
            <code className="block break-all text-xs">{restored.command}</code>
            <p className="break-all text-xs text-muted">
              恢复前安全备份：{restored.safetyBackup}（data/recovery）。原数据库也完整保留。
            </p>
          </div>
        ) : null}
      </Card>
      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={(open) => {
          if (!busy) setConfirmRestore(open)
        }}
        title="创建恢复副本？"
        description="将校验所选文件，并保留当前数据库和一份安全备份。恢复副本需要重启后手动切换；不会覆盖当前数据。"
        confirmLabel="确认创建副本"
        loading={busy === 'restore'}
        onConfirm={() =>
          void perform('restore', async () => {
            if (!file) throw new Error('请先选择备份文件')
            if (file.size > 50 * 1024 * 1024) throw new Error('备份不能超过 50 MB')
            const res = await checked(
              await fetch('/api/workspace/restore', {
                method: 'POST',
                headers: {
                  'X-MorphOS-Request': '1',
                  'X-MorphOS-Restore': 'create-copy',
                  'Content-Type': 'application/octet-stream',
                },
                body: file,
              }),
            )
            setRestored(await res.json())
            setConfirmRestore(false)
          })
        }
      />
    </main>
  )
}
