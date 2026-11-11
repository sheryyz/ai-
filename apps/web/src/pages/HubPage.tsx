import type { AppSummary, TemplateInfo } from '@morphos/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Database, LayoutGrid, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AppIcon } from '../components/AppIcon'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Modal } from '../components/ui/dialog'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback'
import { Input, Label } from '../components/ui/input'
import { api, errorMessage } from '../lib/api'
import { relativeTime } from '../lib/format'
import { SOURCE_LABELS } from '../lib/labels'
import { keys, useApps, useTemplates, useTimeZone } from '../lib/queries'

function TemplateCard({ t }: { t: TemplateInfo }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (withSampleData: boolean) => api.createFromTemplate(t.id, withSampleData),
    onSuccess: async (app) => {
      await qc.invalidateQueries({ queryKey: keys.apps })
      toast.success(`已创建「${app.name}」`)
      navigate(`/apps/${app.id}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <AppIcon name={t.icon} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{t.description}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted tabular-nums">
        {t.fieldCount} 个字段 · {t.componentCount} 个组件 · {t.sampleCount} 条虚构示例
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={create.isPending && create.variables === true}
          disabled={create.isPending}
          onClick={() => create.mutate(true)}
        >
          <Database className="size-3.5" /> 含示例数据
        </Button>
        <Button
          size="sm"
          loading={create.isPending && create.variables === false}
          disabled={create.isPending}
          onClick={() => create.mutate(false)}
        >
          <Plus className="size-3.5" /> 空白创建
        </Button>
      </div>
    </Card>
  )
}

function RenameDialog({ app, onClose }: { app: AppSummary | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const rename = useMutation({
    mutationFn: () => {
      if (!app) throw new Error('no app')
      return api.updateApp(app.id, app.version, { name: name.trim() })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.apps })
      toast.success('已重命名（生成了一个新的配置版本）')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Modal
      open={app !== null}
      onOpenChange={(o) => {
        if (o && app) setName(app.name)
        if (!o) onClose()
      }}
      title="重命名应用"
      description="改名会生成一个新的配置版本，可在版本历史中恢复。"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={rename.isPending}
            disabled={!name.trim() || name.trim() === app?.name}
            onClick={() => rename.mutate()}
          >
            保存
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && name.trim() !== app?.name) rename.mutate()
        }}
      >
        <Label htmlFor="rename">名称</Label>
        <Input id="rename" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      </form>
    </Modal>
  )
}

function AppCard({ app, onRename }: { app: AppSummary; onRename: () => void }) {
  const tz = useTimeZone()
  return (
    <Card className="group relative flex flex-col p-4 transition-shadow duration-150 hover:shadow-[0_2px_8px_rgb(0_0_0/0.06)]">
      <div className="flex items-start gap-3">
        <AppIcon name={app.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            <Link to={`/apps/${app.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {app.name}
            </Link>
          </h3>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted">{app.description ?? '—'}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`重命名「${app.name}」`}
          onClick={onRename}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge>v{app.version}</Badge>
        <Badge>{app.recordCount} 条记录</Badge>
        <Badge>{app.componentCount} 个组件</Badge>
        {app.hasSampleData ? <Badge>含虚构示例</Badge> : null}
      </div>
      <p className="mt-3 truncate text-[11px] text-muted" title={app.lastChange.intent ?? undefined}>
        {SOURCE_LABELS[app.lastChange.source]} · {relativeTime(app.lastChange.at, tz)}
        {app.lastChange.intent ? ` · ${app.lastChange.intent}` : ''}
      </p>
    </Card>
  )
}

export function HubPage() {
  const apps = useApps()
  const templates = useTemplates()
  const [renaming, setRenaming] = useState<AppSummary | null>(null)

  return (
    <main className="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6">
      <p className="font-mono text-xs tracking-wider text-morph uppercase">Intent → Verified Evolution</p>
      <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
        用一句话生成应用，再用一句话让它<span className="text-morph">持续进化</span>。
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        每一次变更都经过六层校验、以差异形式呈现，并在你批准后生效。界面可以回到任何历史版本，业务数据永远不会丢失。
      </p>

      <section className="mt-12" aria-labelledby="my-apps">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="my-apps" className="flex items-center gap-2 text-sm font-semibold">
            <LayoutGrid className="size-4 text-muted" /> 我的应用
          </h2>
          {apps.data?.length ? <span className="text-xs text-muted">{apps.data.length} 个</span> : null}
        </div>
        {apps.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : apps.isError ? (
          <ErrorState message={errorMessage(apps.error)} onRetry={() => apps.refetch()} />
        ) : apps.data.length === 0 ? (
          <Card>
            <EmptyState title="还没有应用" hint="从下方模板开始，或在下一步用自然语言描述你想要的应用。" />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.data.map((a) => (
              <AppCard key={a.id} app={a} onRename={() => setRenaming(a)} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12" aria-labelledby="templates">
        <h2 id="templates" className="mb-1 text-sm font-semibold">
          从示例模板开始
        </h2>
        <p className="mb-3 flex items-center gap-1 text-xs text-muted">
          模板是普通的应用定义数据，与 AI 生成的应用走同一个引擎 <ArrowRight className="size-3" />{' '}
          两个场景没有任何专用页面代码
        </p>
        {templates.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : templates.isError ? (
          <ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.data.map((t) => (
              <TemplateCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </section>

      <RenameDialog app={renaming} onClose={() => setRenaming(null)} />
    </main>
  )
}
