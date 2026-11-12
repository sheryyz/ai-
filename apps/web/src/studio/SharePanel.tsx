/**
 * Studio “分享” tab (design.md §3): one row per role view — link, copy, QR, open here, reset.
 * Tokens come from the admin API; phones reach this machine through its LAN address (ADR-0008).
 */
import { type AppDetail, fieldLabelOf, type ShareInfo, type ViewLinkInfo } from '@morphos/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Info, Link2, RefreshCw, Share2, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { QrCode } from '../components/QrCode'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/dialog'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback'
import { api, errorMessage } from '../lib/api'
import { keys } from '../lib/queries'

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-[var(--radius-control)] border border-change/40 bg-surface-2/60 px-2.5 py-2 text-[11px] leading-relaxed text-change">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function SharePanel({ app }: { app: AppDetail }) {
  const views = useQuery({ queryKey: keys.views(app.id), queryFn: () => api.views(app.id) })
  const info = useQuery({ queryKey: keys.shareInfo, queryFn: api.shareInfo, staleTime: 60_000 })

  if (views.isPending) return <Skeleton className="m-4 h-40" />
  if (views.isError)
    return <ErrorState className="m-4" message={errorMessage(views.error)} onRetry={() => views.refetch()} />
  if (!views.data.length) {
    return (
      <EmptyState
        className="h-full"
        icon={<Share2 className="size-6" />}
        title="还没有分享页"
        hint="用一句话让 AI 为某类人生成专属页面，例如：“给报名的同学一个报名页，填完表就行”。分享页只包含你批准的组件，数据由服务端按页面裁剪后下发。"
      />
    )
  }

  const lan = info.data?.servesWeb ? info.data.baseUrls[0] : undefined
  return (
    <div className="space-y-3 p-4">
      {info.data && !info.data.servesWeb ? (
        <Notice>
          开发模式（npm run dev）下服务端不托管网页，手机打不开分享链接。现场演示请用 npm start
          启动；在本机可以先点“在本机打开”预览。
        </Notice>
      ) : null}
      {info.data?.servesWeb && !info.data.baseUrls.length ? (
        <Notice>没有检测到局域网地址，手机无法访问这台电脑。请连接 Wi-Fi 或手机热点后刷新。</Notice>
      ) : null}
      {views.data.map((v) => (
        <ViewShareCard key={v.viewId} app={app} view={v} lan={lan} info={info.data} />
      ))}
      <p className="text-[11px] leading-relaxed text-muted">
        拿到链接的人只能使用该页面的组件，看到的字段由系统计算并在服务端裁剪。链接不会过期，外泄时请重置。
      </p>
    </div>
  )
}

function ViewShareCard({
  app,
  view,
  lan,
  info,
}: {
  app: AppDetail
  view: ViewLinkInfo
  lan: string | undefined
  info: ShareInfo | undefined
}) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const entity = app.definition.entities[0]
  const label = (id: string) => (entity ? fieldLabelOf(entity, id) : id)
  const refresh = () => qc.invalidateQueries({ queryKey: keys.views(app.id) })
  const create = useMutation({
    mutationFn: () => api.ensureLink(app.id, view.viewId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const reset = useMutation({
    mutationFn: () => api.resetLink(app.id, view.viewId),
    onSuccess: async () => {
      await refresh()
      setResetting(false)
      toast.success(`「${view.label}」已换新链接，旧链接立即失效`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const local = view.token ? `${window.location.origin}/v/${view.token}` : null
  const url = view.token ? (lan ? `${lan}/v/${view.token}` : local) : null
  const e = view.exposure

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('浏览器不允许访问剪贴板，请手动选择链接复制')
    }
  }

  return (
    <section
      className="rounded-[var(--radius-card)] border border-border bg-surface p-3"
      data-view={view.viewId}
    >
      <div className="flex items-center gap-1.5">
        <Users className="size-3.5 text-muted" />
        <h4 className="text-sm font-semibold">{view.label}</h4>
        <span className="truncate text-xs text-muted">· 面向{view.audience}</span>
        {view.active ? null : (
          <Badge tone="danger" className="ml-auto">
            已停用
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        可见：{e.read.map(label).join('、') || '无'} · 可写：{e.write.map(label).join('、') || '无'}
        {e.restricted.length ? ` · 禁止接触：${e.restricted.map(label).join('、')}` : ''}
      </p>
      {!view.active ? (
        <p className="mt-1.5 text-[11px] text-danger">
          这个页面没有可见的组件，打开链接会显示“此页面已停用”。
        </p>
      ) : null}

      {!url ? (
        <Button
          size="sm"
          variant="primary"
          className="mt-3"
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          <Link2 className="size-3.5" /> 生成分享链接
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1.5">
            <input
              readOnly
              value={url}
              onFocus={(ev) => ev.currentTarget.select()}
              aria-label={`「${view.label}」的分享链接`}
              className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2 font-mono text-[11px]"
            />
            <Button size="sm" onClick={copy} aria-label="复制链接">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          {lan ? (
            <div className="flex items-center gap-3">
              <QrCode value={url} size={132} label={`「${view.label}」分享链接的二维码`} />
              <p className="text-[11px] leading-relaxed text-muted">
                手机连接与这台电脑相同的网络后扫码打开。
                {info && info.baseUrls.length > 1
                  ? `本机还有其他地址：${info.baseUrls.slice(1).join('、')}`
                  : ''}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {local ? (
              <a
                href={local}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
              >
                <ExternalLink className="size-3.5" /> 在本机打开
              </a>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
              <RefreshCw className="size-3.5" /> 重置链接
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`重置「${view.label}」的链接？`}
        description="旧链接会立即失效，已经拿到它的人将无法再打开这个页面。新链接需要重新发给大家。"
        confirmLabel="重置"
        danger
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </section>
  )
}
