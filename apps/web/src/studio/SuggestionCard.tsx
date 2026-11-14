import { type EntityDef, type FollowUpSuggestion, fieldLabel, isFilterGroup } from '@morphos/shared'
import { Lightbulb, X } from 'lucide-react'
import { motion } from 'motion/react'
import { Button } from '../components/ui/button'
import { formatMetric } from '../lib/format'
import { describeFilter } from '../runtime/describe'

/** “「已签到」为否” for a single yes/no condition, otherwise “不满足「…」”. */
function notMet(s: FollowUpSuggestion, entity: EntityDef): string {
  const w = s.where
  const field = isFilterGroup(w) ? undefined : entity.fields.find((f) => f.id === w.field)
  if (!isFilterGroup(w) && field?.type === 'boolean' && typeof w.value === 'boolean') {
    const met = w.operator === 'eq' ? w.value : !w.value
    return `「${fieldLabel(entity, w.field)}」为${met ? '否' : '是'}`
  }
  return `不满足「${describeFilter(w, entity)}」`
}

/** The sentence put into the composer; the planner turns it into a proposal the user still approves. */
export function suggestionIntent(s: FollowUpSuggestion, entity: EntityDef): string {
  return `请沿用指标「${s.metricLabel}」（组件 ${s.metricId}）的完整输入范围和上游筛选，为其中不满足该指标条件、且未被现有提醒草稿覆盖的${entity.label}记录生成提醒消息草稿。保留原指标的统计口径与现有提醒，避免重复提醒。先预演提醒对象，再由我批准。`
}

/**
 * One proactive suggestion (design.md §3 主动建议): computed by the system from current data, not AI
 * output, so neutral colours. It only fills the composer; nothing changes until a proposal is approved.
 */
export function SuggestionCard({
  suggestion: s,
  entity,
  aiBlocker,
  onUse,
  onDismiss,
}: {
  suggestion: FollowUpSuggestion
  entity: EntityDef
  aiBlocker: string | null
  onUse: (intent: string) => void
  onDismiss: () => void
}) {
  const missing = notMet(s, entity)
  const records = `${s.remaining} 条${entity.label}记录${missing.startsWith('「') ? '的' : ''}${missing}`
  const reason = s.partlyReached
    ? `${records}，其中 ${s.unreached} 条不在任何消息草稿里。`
    : `${records}，目前没有消息草稿覆盖它们。`
  return (
    <motion.aside
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      aria-label="系统建议"
      className="mb-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-change" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">
            {s.metricLabel} <span className="tabular-nums">{formatMetric(s.rate, 'percent')}</span>
            <span className="ml-1 font-normal text-muted">（{s.total} 条记录）</span>
          </p>
          <p className="leading-relaxed text-muted">{reason}要不要为这些记录生成一份提醒草稿？</p>
          {s.scope.length ? (
            <p className="leading-relaxed text-muted">
              范围：{s.scope.map((f) => describeFilter(f, entity)).join(' 且 ')}
            </p>
          ) : null}
          <p className="text-[11px] text-muted">系统根据当前数据计算 · 不会自动修改</p>
          {aiBlocker ? <p className="text-[11px] text-muted">{aiBlocker}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭建议"
          className="-m-1 rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={aiBlocker !== null} onClick={() => onUse(suggestionIntent(s, entity))}>
          填入输入框
        </Button>
      </div>
    </motion.aside>
  )
}
