import {
  type AppDetail,
  type BusinessConstraint,
  type BusinessRule,
  computeExposure,
  fieldLabelOf,
  primaryEntity,
  recordScope,
  stableStringify,
  viewNodes,
  viewsOf,
} from '@morphos/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/dialog'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback'
import { api, errorMessage } from '../lib/api'
import { POLL_MS } from '../lib/queries'
import { describeFilter } from '../runtime/describe'

type Candidate = { label: string; rule: BusinessRule }

/** Offer explicit, inspectable rules for existing behavior; never silently turn AI text into policy. */
function candidates(app: AppDetail): Candidate[] {
  const def = app.definition
  const entity = primaryEntity(def)
  const out: Candidate[] = []
  for (const view of viewsOf(def)) {
    const exposure = computeExposure(def, view.id)
    if (!exposure?.nodes.length) continue
    if (viewNodes(def, view.id).every((n) => n.type === 'Form')) {
      out.push({
        label: `${view.label}只能提交，不能查看或修改已有记录`,
        rule: { kind: 'submitOnly', viewId: view.id },
      })
    } else if (!exposure.canCreate) {
      out.push({
        label: `${view.label}${exposure.write.length ? `只能修改${exposure.write.map((f) => fieldLabelOf(entity, f)).join('、')}` : '不能修改任何字段'}，不能新增记录`,
        rule: { kind: 'allowedWrites', viewId: view.id, fields: exposure.write },
      })
    }
  }
  for (const node of def.nodes) {
    if (node.type !== 'MessageDraft' || node.hidden) continue
    // Lock each stage individually so long filter chains stay within the DSL's depth and item limits.
    for (const condition of recordScope(def, node.id)) {
      out.push({
        label: `${node.title ?? '提醒草稿'}仅限${describeFilter(condition, entity)}`.slice(0, 120),
        rule: { kind: 'messageScope', nodeId: node.id, condition },
      })
    }
  }
  return out
}

export function ConstraintsPanel({ app }: { app: AppDetail }) {
  const qc = useQueryClient()
  const queryKey = ['constraints', app.id]
  const rules = useQuery({ queryKey, queryFn: () => api.constraints(app.id), refetchInterval: POLL_MS })
  const [confirm, setConfirm] = useState<Candidate | null>(null)
  const [remove, setRemove] = useState<BusinessConstraint | null>(null)
  const changed = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ['proposal-preview'] }),
      qc.invalidateQueries({ queryKey: ['restore-diff', app.id] }),
    ])
  }
  const add = useMutation({
    mutationFn: (c: Candidate) => api.addConstraint(app.id, app.version, c.label, c.rule),
    onSuccess: async () => {
      await changed()
      setConfirm(null)
      toast.success('规则已确认，后续演进和恢复版本都会检查')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: (r: BusinessConstraint) => api.revokeConstraint(app.id, r.id),
    onSuccess: async () => {
      await changed()
      setRemove(null)
      toast.success('规则已解除，当前应用配置保持不变')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (rules.isPending) return <Skeleton className="m-4 h-32" />
  if (rules.isError)
    return <ErrorState className="m-4" message={errorMessage(rules.error)} onRetry={() => rules.refetch()} />
  const active = new Set(rules.data.map((r) => stableStringify(r.rule)))
  const options = candidates(app).filter(
    (c, i, all) =>
      !active.has(stableStringify(c.rule)) &&
      all.findIndex((v) => stableStringify(v.rule) === stableStringify(c.rule)) === i,
  )
  return (
    <div className="space-y-5 p-4">
      <p className="text-xs leading-relaxed text-muted">
        把已确认的业务边界保留下来。AI
        每次演进、手动修改和恢复历史版本都必须遵守；冲突版本不会生效。调整规则时，先明确解除，再确认新规则。
      </p>
      <section className="space-y-2">
        <h4 className="text-xs font-semibold">已确认的规则 · {rules.data.length}</h4>
        {rules.data.length ? (
          rules.data.map((r) => (
            <div key={r.id} className="rounded-[var(--radius-card)] border border-border p-3">
              <p className="flex gap-2 text-xs leading-relaxed">
                <ShieldCheck className="size-4 shrink-0 text-add" />
                {r.label}
              </p>
              {r.rule.kind === 'messageScope' ? (
                <p className="mt-2 break-words text-[11px] text-muted">
                  条件：{describeFilter(r.rule.condition, primaryEntity(app.definition))}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 text-danger"
                disabled={revoke.isPending}
                onClick={() => setRemove(r)}
              >
                解除规则
              </Button>
            </div>
          ))
        ) : (
          <EmptyState title="尚未确认业务约束" hint="下方可将当前应用的业务边界确认为长期规则。" />
        )}
      </section>
      <section className="space-y-2">
        <h4 className="text-xs font-semibold">可确认的当前边界</h4>
        {options.map((c) => (
          <div
            key={stableStringify(c.rule)}
            className="space-y-2 rounded-[var(--radius-card)] border border-border p-3"
          >
            <p className="text-xs leading-relaxed">{c.label}</p>
            {c.rule.kind === 'messageScope' ? (
              <p className="break-words text-[11px] text-muted">
                完整条件：{describeFilter(c.rule.condition, primaryEntity(app.definition))}
              </p>
            ) : null}
            <Button
              size="sm"
              disabled={add.isPending || rules.data.length >= 20}
              onClick={() => setConfirm(c)}
            >
              确认为长期规则
            </Button>
          </div>
        ))}
        {!options.length ? (
          <p className="text-xs leading-relaxed text-muted">
            暂无新的边界可确认。可先在对话中生成角色页面或带筛选的提醒草稿，再来确认它们的提交、写入或提醒范围。
          </p>
        ) : null}
      </section>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !add.isPending && setConfirm(null)}
        title="确认持续执行此规则？"
        description={`${confirm?.label ?? ''}。后续演进不能扩大此边界，也不能移除受保护的页面或提醒组件；恢复旧版本同样会被检查。`}
        confirmLabel="确认规则"
        loading={add.isPending}
        onConfirm={() => confirm && add.mutate(confirm)}
      />
      <ConfirmDialog
        open={remove !== null}
        onOpenChange={(o) => !o && !revoke.isPending && setRemove(null)}
        title="解除此业务规则？"
        description={`「${remove?.label ?? ''}」将不再约束后续演进和版本恢复。解除不会立即改变页面权限或业务记录。`}
        confirmLabel="解除规则"
        danger
        loading={revoke.isPending}
        onConfirm={() => remove && revoke.mutate(remove)}
      />
    </div>
  )
}
