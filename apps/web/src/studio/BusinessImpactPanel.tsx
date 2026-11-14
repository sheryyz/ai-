import type { BusinessState, ProposalPreview } from '@morphos/shared'
import { IssueList } from './IssueList'

function metric(s: BusinessState | null) {
  if (!s) return '无'
  if (s.value === null) return '—'
  return s.format === 'percent' ? `${(s.value * 100).toFixed(1)}%` : String(Number(s.value.toFixed(2)))
}

export function BusinessImpactPanel({ preview }: { preview: ProposalPreview }) {
  const { impact } = preview
  return (
    <section
      className="space-y-2 rounded-[var(--radius-card)] border border-border bg-surface p-3"
      aria-label="业务影响预演"
    >
      <h4 className="text-xs font-semibold">业务影响预演</h4>
      <p className="text-[11px] leading-relaxed text-muted">
        基于当前 {impact.recordCount} 条记录计算；不修改记录，不执行操作，不发送消息。数据变化后会重新计算。
      </p>
      {impact.changes.length === 0 ? (
        <p className="text-xs">当前记录下，名单范围、指标值和可操作对象均无变化。</p>
      ) : null}
      {impact.changes.map((c) => (
        <div key={c.nodeId} className="space-y-1 border-t border-border pt-2 text-xs">
          <p className="font-medium">
            {c.label}
            {!c.before ? ' · 新增' : !c.after ? ' · 移除' : ''}
          </p>
          {c.kind === 'Metric' ? (
            <p>
              指标：{metric(c.before)} → {metric(c.after)}
              {c.after?.matched !== null && c.after
                ? `（命中 ${c.after.matched} / 输入 ${c.after.count}）`
                : ''}
            </p>
          ) : (
            <p>
              {c.kind === 'MessageDraft' ? '提醒对象' : c.kind === 'QuickAction' ? '可操作对象' : '记录范围'}
              ：{c.before?.count ?? 0} → {c.after?.count ?? 0} 条
            </p>
          )}
          {c.before && c.after && c.scopeChanged ? (
            <p className="text-change">筛选或统计口径发生变化</p>
          ) : null}
          {(
            [
              ['进入', c.entered],
              ['退出', c.exited],
            ] as const
          ).map(([label, rows]) =>
            rows.length ? (
              <details key={label}>
                <summary className="cursor-pointer text-muted">
                  {label} {rows.length} 条 · 查看对象
                </summary>
                <ul className="mt-1 space-y-1 pl-2">
                  {rows.slice(0, 20).map((r) => (
                    <li key={r.id} className="break-words">
                      {r.label} <span className="text-[10px] text-muted">{r.id}</span>
                    </li>
                  ))}
                  {rows.length > 20 ? (
                    <li className="text-muted">展示前 20 条，共 {rows.length} 条</li>
                  ) : null}
                </ul>
              </details>
            ) : null,
          )}
        </div>
      ))}
      {preview.constraintIssues.length ? (
        <div className="space-y-2 border-t border-danger/30 pt-2">
          <p className="text-xs font-medium text-danger">违反已确认的业务约束，不能批准</p>
          <IssueList issues={preview.constraintIssues} />
        </div>
      ) : null}
    </section>
  )
}
