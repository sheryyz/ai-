import type { PlanStage, StageStatus } from '@morphos/shared'
import { Check, Minus, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { STAGE_LABELS, STAGES, type Turn } from './turn'

function Dot({ status }: { status: StageStatus | undefined }) {
  if (status === 'running') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-morph-soft">
        <span className="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-morph" />
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-fg text-bg">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-danger text-on-morph">
        <X className="size-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full border border-border text-muted">
        <Minus className="size-2.5" />
      </span>
    )
  }
  return <span className="size-4 rounded-full border border-border" />
}

/** 理解 → 规划 → 生成 → 校验 → 自修复 → 就绪, the current step breathing (design.md §3). */
export function Pipeline({ turn }: { turn: Turn }) {
  return (
    <ol className="flex items-start" aria-label="AI 流水线进度">
      {STAGES.map((s: PlanStage, i) => {
        const st = turn.stages[s]
        const label =
          s === 'repair' && st?.round && st.status !== 'skipped'
            ? `${STAGE_LABELS[s]} ${st.round}/2`
            : STAGE_LABELS[s]
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              <span className={cn('h-px flex-1', i === 0 ? 'opacity-0' : 'bg-border')} />
              <Dot status={st?.status} />
              <span className={cn('h-px flex-1', i === STAGES.length - 1 ? 'opacity-0' : 'bg-border')} />
            </div>
            <span
              className={cn(
                'truncate text-[10.5px] tabular-nums',
                st?.status === 'running'
                  ? 'font-medium text-morph'
                  : st?.status === 'failed'
                    ? 'text-danger'
                    : 'text-muted',
              )}
              title={st?.status === 'skipped' ? `${STAGE_LABELS[s]}：无需` : undefined}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
