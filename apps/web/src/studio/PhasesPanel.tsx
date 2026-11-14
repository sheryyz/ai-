import { type AppDetail, type AppPhase, type ProposalRecord, REGISTRY } from '@morphos/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/dialog'
import { ErrorState, Skeleton } from '../components/ui/feedback'
import { api, errorMessage } from '../lib/api'

export function PhasesPanel({
  app,
  locked,
  onProposed,
}: {
  app: AppDetail
  locked: boolean
  onProposed: (p: ProposalRecord) => void
}) {
  const qc = useQueryClient()
  const phases = useQuery({ queryKey: ['phases', app.id], queryFn: () => api.phases(app.id) })
  const [name, setName] = useState('')
  const [disabled, setDisabled] = useState<Set<string>>(
    () => new Set(app.definition.nodes.filter((n) => n.hidden).map((n) => n.id)),
  )
  const [confirm, setConfirm] = useState(false)
  const [remove, setRemove] = useState<AppPhase | null>(null)
  const nodes = app.definition.nodes.filter((n) => REGISTRY[n.type].visual)
  const save = useMutation({
    mutationFn: () => api.savePhase(app.id, { baseVersion: app.version, name, disabledNodes: [...disabled] }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['phases', app.id] })
      setName('')
      setConfirm(false)
      toast.success('已保存阶段配置，当前应用没有改变')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const propose = useMutation({
    mutationFn: (id: string) => api.proposePhase(app.id, id),
    onSuccess: onProposed,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.removePhase(app.id, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['phases', app.id] })
      setRemove(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (phases.isPending) return <Skeleton className="m-4 h-28" />
  if (phases.isError)
    return <ErrorState message={errorMessage(phases.error)} onRetry={() => phases.refetch()} />
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs leading-relaxed text-muted">
        按业务阶段保存组件启停范围，例如筹备、执行、结束。每次手动切换都先生成提案，预演并批准后生效；不会自动定时执行，也不会解除长期规则。
      </p>
      {phases.data.map((phase) => {
        const matching =
          phase.visibility.length === nodes.length &&
          phase.visibility.every((v) =>
            nodes.some((n) => n.id === v.nodeId && Boolean(n.hidden) === v.hidden),
          )
        return (
          <section key={phase.id} className="space-y-2 rounded border border-border p-3">
            <h4 className="text-sm font-medium">
              {phase.name}
              {matching ? ' · 当前状态符合' : ''}
            </h4>
            <p className="text-xs text-muted">
              停用：
              {phase.visibility
                .filter((v) => v.hidden)
                .map((v) => app.definition.nodes.find((n) => n.id === v.nodeId)?.title ?? v.nodeId)
                .join('、') || '无'}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={locked || matching || propose.isPending}
                onClick={() => propose.mutate(phase.id)}
              >
                预演切换
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemove(phase)}>
                移除配置
              </Button>
            </div>
          </section>
        )
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setConfirm(true)
        }}
        className="space-y-3 border-t border-border pt-3"
      >
        <h4 className="text-sm font-medium">配置一个阶段</h4>
        <label className="block text-xs">
          阶段名称
          <input
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm"
            placeholder="例如：活动结束"
          />
        </label>
        <p className="text-xs text-muted">
          勾选此阶段要停用的组件；未勾选的组件将启用。停用表单或快捷操作会同时阻止对应服务端写入。
        </p>
        <div className="space-y-2">
          {nodes.map((n) => (
            <label key={n.id} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={disabled.has(n.id)}
                onChange={(e) =>
                  setDisabled((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(n.id)
                    else next.delete(n.id)
                    return next
                  })
                }
              />
              {n.title ?? REGISTRY[n.type].label} ·{' '}
              {n.view ? app.definition.views?.find((v) => v.id === n.view)?.label : '管理页'} ·{' '}
              {REGISTRY[n.type].label}
            </label>
          ))}
        </div>
        <Button type="submit" size="sm" disabled={!name.trim() || phases.data.length >= 12}>
          保存阶段配置
        </Button>
      </form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !save.isPending && setConfirm(o)}
        title={`保存阶段「${name}」？`}
        description={`此配置将停用 ${disabled.size} 个组件、启用 ${nodes.length - disabled.size} 个组件。保存本身不会切换当前应用；切换时仍需校验与批准。`}
        confirmLabel="保存配置"
        loading={save.isPending}
        onConfirm={() => save.mutate()}
      />
      <ConfirmDialog
        open={remove !== null}
        onOpenChange={(o) => !o && !revoke.isPending && setRemove(null)}
        title="移除阶段配置？"
        description="只移除这个预设，当前界面、历史版本和业务记录保持不变。"
        confirmLabel="移除配置"
        loading={revoke.isPending}
        onConfirm={() => remove && revoke.mutate(remove.id)}
      />
    </div>
  )
}
