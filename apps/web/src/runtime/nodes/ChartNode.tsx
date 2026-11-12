import { asRows, groupCounts, type ParamsOf } from '@morphos/shared'
import { ChartBar, ChartPie } from 'lucide-react'
import { EmptyState } from '../../components/ui/feedback'
import { type NodeProps, useRuntime } from '../context'
import { NodeFrame } from '../NodeFrame'

/** Shades of the single accent token, so charts stay within the design palette in both themes. */
const shade = (i: number, n: number) =>
  `color-mix(in oklab, var(--morph) ${Math.round(100 - (i * 70) / Math.max(1, n - 1))}%, var(--surface))`

export function ChartNode({ title, params, ev, mark, data }: NodeProps<ParamsOf<'Chart'>>) {
  const { entity } = useRuntime()
  const field = entity.fields.find((f) => f.id === params.groupBy)
  const groups =
    data?.kind === 'groups' ? data.groups : field ? groupCounts(asRows(ev?.inputs.rows), field) : []
  const max = Math.max(1, ...groups.map((g) => g.count))
  const total = groups.reduce((s, g) => s + g.count, 0)
  const Icon = params.kind === 'donut' ? ChartPie : ChartBar

  return (
    <NodeFrame
      title={title ?? `${field?.label ?? params.groupBy}分布`}
      icon={<Icon className="size-4" />}
      subtitle={`按「${field?.label ?? params.groupBy}」分组 · ${total} 条`}
      mark={mark}
    >
      {total === 0 ? (
        <EmptyState className="py-6" title="暂无数据" hint="录入记录后自动统计" />
      ) : params.kind === 'donut' ? (
        <Donut groups={groups} total={total} />
      ) : (
        <ul className="space-y-1.5">
          {groups.map((g, i) => (
            <li key={g.key} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-xs">
              <span className="truncate text-muted" title={g.label}>
                {g.label}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full transition-[width] duration-250 ease-out"
                  style={{ width: `${(g.count / max) * 100}%`, background: shade(i, groups.length) }}
                />
              </span>
              <span className="text-right font-medium tabular-nums">{g.count}</span>
            </li>
          ))}
        </ul>
      )}
    </NodeFrame>
  )
}

function Donut({
  groups,
  total,
}: {
  groups: { key: string; label: string; count: number }[]
  total: number
}) {
  const R = 15.9155 // circumference ≈ 100
  let offset = 25
  const visible = groups.filter((g) => g.count > 0)
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 42 42" className="size-28 shrink-0" role="img" aria-label="分布环形图">
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
        {visible.map((g, i) => {
          const pct = (g.count / total) * 100
          const el = (
            <circle
              key={g.key}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={shade(i, visible.length)}
              strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          )
          offset -= pct
          return el
        })}
      </svg>
      <ul className="min-w-0 space-y-1 text-xs">
        {visible.map((g, i) => (
          <li key={g.key} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: shade(i, visible.length) }} />
            <span className="truncate text-muted">{g.label}</span>
            <span className="ml-auto pl-2 font-medium tabular-nums">
              {Math.round((g.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
