import { asRows, evaluateFilter, fieldTypesOf, type ParamsOf } from '@morphos/shared'
import { Gauge } from 'lucide-react'
import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { formatMetric } from '../../lib/format'
import { type NodeProps, useRuntime } from '../context'
import { NodeFrame } from '../NodeFrame'

/** Numbers roll to their new value (design.md §4) unless the user prefers reduced motion. */
function AnimatedNumber({ value, format }: { value: number | null; format: 'number' | 'percent' }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    const from = prev.current
    prev.current = value
    if (reduce || value === null || from === null) {
      setShown(value)
      return
    }
    const c = animate(from, value, { duration: 0.4, ease: 'easeOut', onUpdate: setShown })
    return () => c.stop()
  }, [value, reduce])
  const text = formatMetric(
    shown === null
      ? null
      : format === 'number' && value !== null && Number.isInteger(value)
        ? Math.round(shown)
        : shown,
    format,
  )
  return <>{text}</>
}

export function MetricNode({ title, params, ev, mark, data }: NodeProps<ParamsOf<'Metric'>>) {
  const { entity, today } = useRuntime()
  const shared = data?.kind === 'metric' ? data : null
  const rows = asRows(ev?.inputs.rows)
  const count = shared ? shared.count : rows.length
  const value = shared ? shared.value : typeof ev?.outputs.value === 'number' ? ev.outputs.value : null
  const where = params.where
  const matched =
    params.aggregate !== 'ratio' || !where
      ? null
      : shared
        ? shared.matched
        : rows.filter((r) => evaluateFilter(where, r, fieldTypesOf(entity), { today })).length
  const progress =
    params.goal && value !== null
      ? Math.min(1, value / params.goal)
      : params.format === 'percent'
        ? (value ?? 0)
        : null

  return (
    <NodeFrame title={title ?? params.label} icon={<Gauge className="size-4" />} mark={mark}>
      <p className="text-3xl font-semibold tracking-tight tabular-nums" aria-live="polite">
        <AnimatedNumber value={value} format={params.format} />
      </p>
      <p className="mt-1 text-xs text-muted tabular-nums">
        {matched !== null
          ? `${matched} / ${count} 条`
          : params.goal
            ? `目标 ${params.goal.toLocaleString('zh-CN')}`
            : `基于 ${count} 条记录`}
      </p>
      {progress !== null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-morph transition-[width] duration-250 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
    </NodeFrame>
  )
}
