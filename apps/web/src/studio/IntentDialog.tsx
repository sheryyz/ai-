import type { PreparedIntent } from '@morphos/shared'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'

export function IntentDialog({
  prepared,
  busy,
  onClose,
  onGenerate,
  onResume,
}: {
  prepared: PreparedIntent
  busy: boolean
  onClose: () => void
  onGenerate: (answers: number[], choice: 0 | 1 | 'compare') => void
  onResume: () => void
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const complete = !prepared.resolution && prepared.brief.questions.every((_, i) => answers[i] !== undefined)
  const generate = (choice: 0 | 1 | 'compare') =>
    onGenerate(
      prepared.brief.questions.map((_, i) => answers[i] ?? -1),
      choice,
    )
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="先确认业务含义，再生成方案"
      description={prepared.brief.summary}
      className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col [&>div:first-child]:shrink-0 [&>div:last-child]:shrink-0"
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="morph"
            disabled={!complete || busy}
            loading={busy}
            onClick={() => generate('compare')}
          >
            生成两个方案并比较
          </Button>
        </>
      }
    >
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {prepared.resolution ? (
          <div className="space-y-2 rounded border border-border p-3 text-sm">
            <p>这次业务确认已提交生成。可以查看已保存的方案；若生成中断且没有结果，请取消后重新分析需求。</p>
            <Button size="sm" onClick={onResume}>
              查看已保存的方案
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          以下是 AI 的建议，尚未通过执行校验。你的选择会被记录；生成的方案仍需预演和批准。
        </p>
        {prepared.brief.questions.length === 0 ? (
          <p className="text-sm">未识别到需要追问的关键歧义，请核对目标并选择方案。</p>
        ) : null}
        {prepared.brief.questions.map((q, i) => (
          <fieldset key={q.question} className="space-y-2 rounded border border-border p-3">
            <legend className="px-1 text-sm font-medium">{q.question}</legend>
            <p className="text-xs text-muted">{q.reason}</p>
            {q.options.map((o, j) => (
              <label key={o.label} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`question-${i}`}
                  checked={answers[i] === j}
                  disabled={busy}
                  onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                  className="mt-1"
                />
                <span>
                  {o.label}
                  <span className="block text-xs text-muted">{o.effect}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          {prepared.brief.alternatives.map((option, i) => (
            <section key={option.title} className="space-y-2 rounded border border-dashed border-morph p-3">
              <h3 className="text-sm font-semibold">
                {i === 0 ? 'A' : 'B'} · {option.title}
              </h3>
              <p className="text-xs leading-relaxed">{option.approach}</p>
              <p className="text-xs text-muted">取舍：{option.tradeoff}</p>
              <Button size="sm" disabled={!complete || busy} onClick={() => generate(i === 0 ? 0 : 1)}>
                仅生成方案 {i === 0 ? 'A' : 'B'}
              </Button>
            </section>
          ))}
        </div>
        {busy ? (
          <p role="status" className="text-sm text-morph">
            正在生成并校验候选方案，复杂需求可能需要数十秒。应用尚未改变。
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
