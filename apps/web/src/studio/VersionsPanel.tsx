import type { AppDetail, VersionInfo } from '@morphos/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { ErrorState, Skeleton } from '../components/ui/feedback'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { relativeTime } from '../lib/format'
import { SOURCE_LABELS } from '../lib/labels'
import { keys, useTimeZone, useVersions } from '../lib/queries'
import { DiffBody } from './DiffPanel'

export function VersionsPanel({
  app,
  locked,
  onRestored,
}: {
  app: AppDetail
  /** A pending proposal is based on the current version; restoring would make it stale. */
  locked: boolean
  onRestored: (version: number) => void
}) {
  const versions = useVersions(app.id)
  const tz = useTimeZone()
  const qc = useQueryClient()
  const [target, setTarget] = useState<VersionInfo | null>(null)
  const preview = useQuery({
    queryKey: ['restore-diff', app.id, target?.version, app.version],
    queryFn: () => api.restoreDiff(app.id, target?.version ?? 0),
    enabled: target !== null,
  })
  const restore = useMutation({
    mutationFn: () => api.restore(app.id, target?.version ?? 0, app.version),
    onSuccess: async (r) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.app(app.id) }),
        qc.invalidateQueries({ queryKey: keys.versions(app.id) }),
        qc.invalidateQueries({ queryKey: keys.apps }),
        qc.invalidateQueries({ queryKey: ['recordings'] }),
      ])
      toast.success(
        `已恢复 v${target?.version} 的界面（生成 v${r.version}），${app.recordCount} 条业务记录未改变`,
      )
      onRestored(r.version)
      setTarget(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (versions.isPending) return <Skeleton className="m-4 h-40" />
  if (versions.isError)
    return (
      <ErrorState className="m-4" message={errorMessage(versions.error)} onRetry={() => versions.refetch()} />
    )

  return (
    <div className="p-4">
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        版本只追加、不改写。恢复 = 用旧版本的界面配置生成一个新版本；业务记录永远不受影响。
      </p>
      <ol className="relative space-y-3 border-l border-border pl-4">
        {versions.data.map((v) => {
          const current = v.version === app.version
          return (
            <li key={v.version} className="relative">
              <span
                className={cn(
                  'absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface',
                  current ? 'bg-morph' : 'bg-border',
                )}
              />
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums">v{v.version}</span>
                <Badge tone={v.source === 'ai' ? 'morph' : v.source === 'recorded' ? 'change' : 'neutral'}>
                  {SOURCE_LABELS[v.source]}
                  {v.restoredFrom ? ` v${v.restoredFrom}` : ''}
                </Badge>
                {current ? <Badge tone="add">当前</Badge> : null}
                <span className="ml-auto text-[11px] text-muted">{relativeTime(v.createdAt, tz)}</span>
              </div>
              {v.intent ? <p className="mt-1 text-xs leading-relaxed">{v.intent}</p> : null}
              {v.summary ? (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{v.summary}</p>
              ) : null}
              {!current ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 -ml-2"
                  disabled={locked}
                  title={locked ? '请先批准或拒绝当前提案' : undefined}
                  onClick={() => setTarget(v)}
                >
                  <RotateCcw className="size-3.5" /> 恢复此版本界面
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>

      <Modal
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`恢复到 v${target?.version} 的界面？`}
        description={`将生成新版本 v${app.version + 1}。只替换界面配置，${app.recordCount} 条业务记录保持不变；之后也可以再恢复回来。`}
        className="max-w-lg"
        footer={
          <>
            <Button onClick={() => setTarget(null)}>取消</Button>
            <Button
              variant="primary"
              loading={restore.isPending}
              disabled={!preview.data}
              onClick={() => restore.mutate()}
            >
              恢复
            </Button>
          </>
        }
      >
        <div className="max-h-[50vh] overflow-y-auto">
          {preview.isPending ? (
            <Skeleton className="h-24" />
          ) : preview.isError ? (
            <ErrorState message={errorMessage(preview.error)} />
          ) : (
            <>
              <p className="mb-3 text-sm font-medium">{preview.data.summary}</p>
              <DiffBody diff={preview.data} before={app.definition} after={null} />
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
