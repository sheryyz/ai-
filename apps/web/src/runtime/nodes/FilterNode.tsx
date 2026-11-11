import { asRows, type ParamsOf } from '@morphos/shared'
import { Funnel } from 'lucide-react'
import { type NodeProps, useRuntime } from '../context'
import { filterChips } from '../describe'
import { NodeFrame } from '../NodeFrame'

export function FilterNode({ title, params, ev, mark }: NodeProps<ParamsOf<'Filter'>>) {
  const { entity } = useRuntime()
  const input = asRows(ev?.inputs.input)
  const result = asRows(ev?.outputs.result)
  return (
    <NodeFrame
      title={title ?? '筛选'}
      icon={<Funnel className="size-4" />}
      mark={mark}
      actions={
        <span className="text-xs text-muted tabular-nums">
          <span className="text-base font-semibold text-fg">{result.length}</span> / {input.length} 条
        </span>
      }
    >
      {params.showChips ? (
        <div className="flex flex-wrap gap-1.5">
          {filterChips(params.filter, entity).map((c) => (
            <span
              key={c.key}
              className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-2 py-1 text-xs"
            >
              {c.text}
            </span>
          ))}
        </div>
      ) : null}
    </NodeFrame>
  )
}
