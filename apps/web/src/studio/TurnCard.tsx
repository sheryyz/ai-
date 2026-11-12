import { formatTimestamp, type ProposalRecord } from '@morphos/shared'
import { Brain, ChevronRight, CircleCheck, CornerDownLeft, RotateCw, ShieldX, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { cn } from '../lib/cn'
import { useTimeZone } from '../lib/queries'
import { IssueList } from './IssueList'
import { Pipeline } from './Pipeline'
import type { RoundView, Turn } from './turn'

const summaryOf = (p?: ProposalRecord) =>
  (p?.proposal ?? {}) as { summary?: string; reason?: string; suggestion?: string }

export function OriginBadge({
  origin,
  model,
  proposal,
}: {
  origin?: string
  model?: string
  proposal?: ProposalRecord
}) {
  const tz = useTimeZone()
  if (origin === 'recorded') {
    const rec = proposal?.trace.recording
    // Model and date sit outside the pill so they can wrap in the narrow conversation column.
    return (
      <>
        <Badge tone="change" title="录制的真实模型响应，经当前系统重新校验；不是实时生成">
          演示样例 · 非实时生成
        </Badge>
        {rec ? (
          <span className="text-[11px] text-muted">
            {rec.model} · 录制于 {formatTimestamp(rec.recordedAt, tz).slice(0, 10)}
          </span>
        ) : null}
      </>
    )
  }
  return origin ? <Badge tone="morph">AI 实时 · {model}</Badge> : null
}

function Thinking({ r, live, multi }: { r: RoundView; live: boolean; multi: boolean }) {
  const [open, setOpen] = useState(live)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setOpen(live), [live])
  const length = r.thinking.length
  useEffect(() => {
    if (length && open && live && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [length, open, live])
  if (!r.thinking && !r.outputChars) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted hover:text-fg"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
        <Brain className="size-3.5" />
        {multi ? `第 ${r.round + 1} 轮 · ` : ''}思考过程 · {r.thinking.length.toLocaleString('zh-CN')} 字
        {r.outputChars ? ` · 提案 JSON ${r.outputChars.toLocaleString('zh-CN')} 字符` : ''}
        {r.ms ? ` · ${(r.ms / 1000).toFixed(1)} s` : ''}
      </button>
      {open && r.thinking ? (
        <div
          ref={box}
          className="mt-1.5 max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-dashed border-morph/40 bg-morph-soft px-2.5 py-2 text-xs leading-relaxed whitespace-pre-wrap text-fg/80"
        >
          {r.thinking}
          {live ? (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-morph align-middle" />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function TurnCard({
  turn,
  onRetry,
  onEdit,
  current,
}: {
  turn: Turn
  /** Re-plan with this intent immediately. */
  onRetry?: (intent: string) => void
  /** Put this intent into the composer for editing. */
  onEdit?: (intent: string) => void
  /** The turn whose proposal is currently awaiting a decision. */
  current?: boolean
}) {
  const p = turn.proposal
  const s = summaryOf(p)
  const lastRound = turn.rounds.at(-1)
  const failedIssues = turn.rounds.flatMap((r) => r.issues).filter((i) => i.level === 'error')
  const blockingIssues = p?.issues.filter((i) => i.level === 'error') ?? []

  return (
    <div className="space-y-2">
      <div className="ml-8 rounded-[var(--radius-card)] bg-surface-2 px-3 py-2 text-sm leading-relaxed">
        {turn.intent}
      </div>
      <div
        className={cn(
          'space-y-3 rounded-[var(--radius-card)] border bg-surface p-3',
          current ? 'border-dashed border-morph shadow-[0_0_0_3px_var(--morph-soft)]' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles className="size-3.5 text-morph" />
          <span className="text-xs font-medium">MorphOS</span>
          <OriginBadge origin={turn.origin} model={turn.model} proposal={p} />
          {turn.done && turn.totalMs ? (
            <span className="ml-auto text-[11px] text-muted tabular-nums">
              {(turn.totalMs / 1000).toFixed(1)} s
            </span>
          ) : null}
        </div>
        <Pipeline turn={turn} />
        {turn.context ? <p className="text-[11px] leading-relaxed text-muted">{turn.context}</p> : null}

        {turn.rounds.map((r) => (
          <div key={r.round} className="space-y-2">
            <Thinking
              r={r}
              live={turn.live && !turn.done && r === lastRound}
              multi={turn.rounds.length > 1}
            />
            {r.issues.length && (r.repairable || turn.outcome !== 'blocked') ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-danger">
                  第 {r.round + 1} 轮校验未通过 · {r.issues.filter((i) => i.level === 'error').length} 个问题
                  {r.repairable ? ' → 回馈模型自修复' : ''}
                </p>
                <IssueList issues={r.issues.filter((i) => i.level === 'error')} compact />
              </div>
            ) : null}
          </div>
        ))}

        {turn.error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border border-danger/30 bg-danger/5 p-2.5 text-xs"
          >
            <p className="font-medium text-danger">规划中断：{turn.error.message}</p>
            <p className="mt-1 text-muted">应用没有任何改动。</p>
            {onRetry ? (
              <Button size="sm" className="mt-2" onClick={() => onRetry(turn.intent)}>
                <RotateCw className="size-3.5" /> 重试
              </Button>
            ) : null}
          </div>
        ) : null}

        {turn.outcome === 'pending' && p ? (
          <div className="text-xs leading-relaxed">
            <p className="font-medium">{s.summary}</p>
            <p className="mt-1 flex items-center gap-1.5 text-muted">
              {p.status === 'approved' ? (
                <>
                  <CircleCheck className="size-3.5 text-add" /> 已批准，生成 v{p.resultVersion}
                </>
              ) : p.status === 'rejected' ? (
                '已拒绝，应用未改动'
              ) : (
                <>提案已通过七层校验，等待你在右侧确认</>
              )}
            </p>
          </div>
        ) : null}

        {turn.outcome === 'refused' ? (
          <div className="rounded-[var(--radius-control)] border border-danger/40 p-2.5 text-xs leading-relaxed">
            <p className="flex items-center gap-1.5 font-medium text-danger">
              <ShieldX className="size-3.5" /> AI 拒绝了这个需求
            </p>
            <p className="mt-1">{s.reason}</p>
            {s.suggestion ? (
              <div className="mt-2 rounded-[var(--radius-control)] bg-surface-2 p-2">
                <p className="text-muted">建议改为：</p>
                <p className="mt-0.5">{s.suggestion}</p>
                {onRetry ? (
                  <Button
                    size="sm"
                    variant="morph"
                    className="mt-2"
                    onClick={() => onRetry(s.suggestion ?? '')}
                  >
                    <CornerDownLeft className="size-3.5" /> 按建议重试
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {turn.outcome === 'blocked' ? (
          <div className="rounded-[var(--radius-control)] border border-danger/40 p-2.5 text-xs leading-relaxed">
            <p className="flex items-center gap-1.5 font-medium text-danger">
              <ShieldX className="size-3.5" /> 已被 L5 安全层拦截，不会自动修复
            </p>
            <p className="mt-1 text-muted">
              自动修复会悄悄改变你的意图，所以系统停下来交给你决定。业务记录未被触碰。
            </p>
            <div className="mt-2">
              <IssueList issues={blockingIssues} />
            </div>
            {onEdit ? (
              <Button size="sm" className="mt-2" onClick={() => onEdit(turn.intent)}>
                改写需求
              </Button>
            ) : null}
          </div>
        ) : null}

        {turn.outcome === 'failed' ? (
          <div className="rounded-[var(--radius-control)] border border-danger/40 p-2.5 text-xs leading-relaxed">
            <p className="font-medium text-danger">
              校验未通过{turn.rounds.length > 1 ? `（已自修复 ${turn.rounds.length - 1} 轮）` : ''}
              ，应用没有任何改动
            </p>
            {blockingIssues.length && !failedIssues.length ? (
              <div className="mt-2">
                <IssueList issues={blockingIssues} />
              </div>
            ) : null}
            {onRetry ? (
              <Button size="sm" className="mt-2" onClick={() => onRetry(turn.intent)}>
                <RotateCw className="size-3.5" /> 重新规划
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
