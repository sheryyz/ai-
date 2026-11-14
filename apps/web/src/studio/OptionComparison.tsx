import type { ProposalRecord } from '@morphos/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { ErrorState, Skeleton } from '../components/ui/feedback'
import { api, errorMessage } from '../lib/api'
import { POLL_MS } from '../lib/queries'
import { BusinessImpactPanel } from './BusinessImpactPanel'

export function OptionComparison({
  groupId,
  selectedId,
  onSelect,
}: {
  groupId: string
  selectedId?: string
  onSelect: (p: ProposalRecord) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const group = useQuery({
    queryKey: ['proposal-group', groupId],
    queryFn: () => api.group(groupId),
    refetchInterval: POLL_MS,
  })
  const brief = useQuery({ queryKey: ['intent-brief', groupId], queryFn: () => api.brief(groupId) })
  if (group.isPending) return <Skeleton className="m-3 h-20" />
  if (group.isError) return <ErrorState message={errorMessage(group.error)} onRetry={() => group.refetch()} />
  return (
    <section className="space-y-2 border-b border-border p-3" aria-label="候选方案比较">
      <h3 className="text-xs font-semibold">方案比较 · 同次数据快照</h3>
      <Button size="sm" onClick={() => setExpanded(true)}>
        展开并排对比
      </Button>
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title="比较候选方案"
        description="同一轮快照中的真实影响。选择后查看完整变更并批准，选择本身不会生效。"
        className="max-w-4xl"
      >
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto sm:grid-cols-2">
          {group.data.options.map(({ proposal: p, preview, error }) => (
            <section key={p.id} className="space-y-3 rounded border border-border p-3">
              <h3 className="text-sm font-semibold">{p.optionLabel ?? '候选方案'}</h3>
              <p className="text-xs">{p.diff?.summary ?? p.issues[0]?.message ?? '未生成可用提案'}</p>
              <p className="text-xs text-muted">
                新增字段 {p.diff?.fields.added.length ?? 0} · 新增组件 {p.diff?.nodes.added.length ?? 0} ·
                敏感公开需确认：{p.diff?.confirmExposure ? '是' : '否'}
              </p>
              {preview ? (
                <BusinessImpactPanel preview={preview} />
              ) : (
                <p className="text-xs text-danger">{error ?? '此方案已处理或未通过校验'}</p>
              )}
              <Button
                size="sm"
                disabled={p.status !== 'pending'}
                onClick={() => {
                  onSelect(p)
                  setExpanded(false)
                }}
              >
                选择并查看完整变更
              </Button>
            </section>
          ))}
        </div>
      </Modal>
      {brief.data?.resolution ? (
        <details className="text-xs">
          <summary className="cursor-pointer">查看已确认的业务含义</summary>
          <p className="mt-1">{brief.data.intent}</p>
          {brief.data.brief.questions.map((q, i) => (
            <p key={q.question} className="mt-1 text-muted">
              {q.question} → {q.options[brief.data?.resolution?.answers[i] ?? -1]?.label ?? '无选择'}
            </p>
          ))}
        </details>
      ) : null}
      <p className="text-[11px] text-muted">
        先选择方案查看完整预演，再在下方批准；批准一个后同组其他待批准方案自动关闭。
      </p>
      {group.data.options.map(({ proposal: p, preview, error }) => (
        <div
          key={p.id}
          className={`space-y-1 rounded border p-2 text-xs ${p.id === selectedId ? 'border-morph bg-morph-soft' : 'border-border'}`}
        >
          <p className="font-medium">
            {p.optionLabel ?? '候选方案'} ·{' '}
            {
              {
                pending: '待批准',
                approved: '已生效',
                rejected: '已关闭',
                invalid: '校验失败',
                refused: '无法实现',
              }[p.status]
            }
          </p>
          <p>{p.diff?.summary ?? p.issues[0]?.message ?? '模型未给出可生效方案'}</p>
          {preview ? (
            <>
              <p>
                基于 {preview.impact.recordCount} 条记录 · {preview.impact.changes.length} 项业务影响 ·{' '}
                {preview.constraintIssues.length} 项约束冲突
              </p>
              <p>
                风险：{{ low: '低', medium: '中', high: '高' }[p.diff?.risk ?? 'low']} · 需确认敏感公开：
                {p.diff?.confirmExposure ? '是' : '否'}
              </p>
              <p>
                各分享页可见字段：
                {p.diff?.exposure
                  .filter((e) => e.after)
                  .map((e) => `${e.after?.label} ${e.after?.read.length ?? 0} 项`)
                  .join('；') || '无分享页变化'}
              </p>
            </>
          ) : null}
          {error ? <p className="text-danger">{error}</p> : null}
          <Button size="sm" disabled={p.status !== 'pending'} onClick={() => onSelect(p)}>
            {p.id === selectedId ? '正在查看' : '查看此方案'}
          </Button>
        </div>
      ))}
    </section>
  )
}
