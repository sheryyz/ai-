import {
  type AppDefinition,
  explainNode,
  fieldLabelOf,
  primaryEntity,
  type StoredRecord,
} from '@morphos/shared'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { useToday } from '../lib/queries'
import { describeFilter } from './describe'

export function ResultExplanation({
  definition,
  records,
  nodeId,
}: {
  definition: AppDefinition
  records: StoredRecord[]
  nodeId: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const today = useToday()
  const result = open ? explainNode(definition, records, nodeId, { today }) : null
  const entity = primaryEntity(definition)
  const selected =
    result?.records.filter((r) => !search || r.label.includes(search) || r.id.includes(search)) ?? []
  return (
    <>
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpen(true)}>
        查看计算依据
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`${result?.label ?? '结果'} · 计算依据`}
        description="依据当前数据和实际筛选过程计算。此解释仅在管理端可见。"
        className="max-w-lg"
      >
        {result ? (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto text-sm">
            <p>
              业务日期：{today} · 数据源 {result.total} 条 → 组件输入 {result.inputCount} 条
            </p>
            {result.steps.map((s) => (
              <p key={s.nodeId}>
                {s.label}：{describeFilter(s.condition, entity)}，{s.before} → {s.after} 条
              </p>
            ))}
            {result.where ? (
              <p>
                {result.kind === 'Metric' ? '命中' : '可操作'}条件：{describeFilter(result.where, entity)}
                ，符合 {result.matched} 条
              </p>
            ) : null}
            {result.aggregate ? (
              <p className="rounded border border-border p-2">
                {result.aggregate === 'ratio'
                  ? `${result.matched} ÷ ${result.inputCount} = ${result.result === null ? '无结果（分母为零）' : `${(result.result * 100).toFixed(1)}%`}`
                  : `${({ count: '计数', sum: '求和', avg: '平均值', min: '最小值', max: '最大值' } as Record<string, string>)[result.aggregate]}${result.field ? `「${fieldLabelOf(entity, result.field)}」` : ''} = ${result.result ?? '无结果'}`}
              </p>
            ) : null}
            <label className="block">
              核对一条记录
              <input
                className="mt-1 block w-full rounded border border-border bg-surface p-2"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按名称或记录编号搜索"
              />
            </label>
            <p className="text-xs text-muted">
              逐条条件按该记录独立计算；“符合”表示进入结果范围，或命中指标条件。数值聚合会忽略非数值。
            </p>
            {selected.slice(0, 30).map((r) => (
              <details key={r.id} className="rounded border border-border p-2">
                <summary className="cursor-pointer">
                  {r.label} · {r.included ? '符合' : '不符合'}
                </summary>
                <p className="text-xs text-muted">{r.id}</p>
                {r.checks.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: immutable ordered path inside this record explanation
                  <p key={`${c.label}-${i}`} className="mt-1 text-xs">
                    {c.passed ? '✓' : '✗'} {c.label}：{describeFilter(c.condition, entity)}
                  </p>
                ))}
              </details>
            ))}
            {!selected.length ? (
              <p>没有匹配记录。</p>
            ) : (
              <p className="text-xs text-muted">共 {selected.length} 条，最多展示前 30 条；可搜索定位。</p>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
