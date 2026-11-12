import {
  type AppDefinition,
  type Binding,
  bindingColumns,
  evaluateGraph,
  materialize,
  primaryEntity,
  REGISTRY,
  type StoredRecord,
  viewsOf,
} from '@morphos/shared'
import { useId, useMemo } from 'react'
import { cn } from '../lib/cn'
import { useToday } from '../lib/queries'

// Three columns fill the 380px Studio side panel exactly (3 × 96 + 2 × 30 = 348 inside its padding).
const W = 96
const H = 44
const GAP_X = 30
const GAP_Y = 10

const edgeKey = (b: Binding) => `${b.from.node}.${b.from.port}>${b.to.node}.${b.to.port}`

/**
 * Read-only data-flow view of the binding graph (design.md §3): columns follow the flow left to right,
 * each link is labelled with how many records pass through it now. With `before`, nodes and links the
 * pending proposal adds are drawn dashed in the morph colour (`before = null`: a create proposal, all new).
 */
export function FlowGraph({
  definition,
  before,
  records,
}: {
  definition: AppDefinition
  before?: AppDefinition | null
  records: StoredRecord[]
}) {
  const today = useToday()
  const marker = useId()
  const { columns, detached } = useMemo(() => bindingColumns(definition), [definition])
  const evaluated = useMemo(() => {
    const entity = primaryEntity(definition)
    return evaluateGraph(
      definition,
      records.map((r) => materialize(r, entity)),
      { today },
    )
  }, [definition, records, today])

  const byId = new Map(definition.nodes.map((n) => [n.id, n]))
  const viewLabel = new Map(viewsOf(definition).map((v) => [v.id, v.label]))
  const oldNodes = before === undefined ? null : new Set((before?.nodes ?? []).map((n) => n.id))
  const oldEdges = before === undefined ? null : new Set((before?.bindings ?? []).map(edgeKey))

  const height = Math.max(0, ...columns.map((c) => c.length)) * (H + GAP_Y) - GAP_Y
  const width = columns.length * (W + GAP_X) - GAP_X
  const pos = new Map<string, { x: number; y: number }>()
  for (const [c, col] of columns.entries()) {
    const top = (height - (col.length * (H + GAP_Y) - GAP_Y)) / 2
    for (const [i, id] of col.entries()) pos.set(id, { x: c * (W + GAP_X), y: top + i * (H + GAP_Y) })
  }
  const edges = definition.bindings.flatMap((b) => {
    const a = pos.get(b.from.node)
    const z = pos.get(b.to.node)
    if (!a || !z) return []
    const v = evaluated.get(b.from.node)?.outputs[b.from.port]
    return [
      {
        b,
        a,
        z,
        count: Array.isArray(v) ? v.length : null,
        added: oldEdges ? !oldEdges.has(edgeKey(b)) : false,
      },
    ]
  })

  const label = (id: string) => {
    const n = byId.get(id)
    return n ? (n.title ?? REGISTRY[n.type].label) : id
  }
  const sub = (id: string) => {
    const n = byId.get(id)
    if (!n) return ''
    const page = n.view ? (viewLabel.get(n.view) ?? n.view) : null
    return [REGISTRY[n.type].label, page, n.hidden ? '已隐藏' : null].filter(Boolean).join(' · ')
  }

  return (
    <div className="space-y-2">
      {columns.length ? (
        <div className="overflow-x-auto pb-1">
          <div
            className="relative"
            style={{ width, height }}
            role="img"
            aria-label={`数据流图：${columns.flat().length} 个组件、${edges.length} 条连接，从左到右为数据流向`}
          >
            <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
              <defs>
                {(['plain', 'morph'] as const).map((k) => (
                  <marker
                    key={k}
                    id={`${marker}-${k}`}
                    viewBox="0 0 6 6"
                    refX="5.5"
                    refY="3"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 z" fill={k === 'morph' ? 'var(--morph)' : 'var(--text-muted)'} />
                  </marker>
                ))}
              </defs>
              {edges.map(({ b, a, z, count, added }) => {
                const x1 = a.x + W
                const y1 = a.y + H / 2
                const x2 = z.x
                const y2 = z.y + H / 2
                const dx = (x2 - x1) / 2
                return (
                  <g key={b.id}>
                    <title>{`${label(b.from.node)}.${b.from.port} → ${label(b.to.node)}.${b.to.port}`}</title>
                    <path
                      d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 1},${y2}`}
                      fill="none"
                      stroke={added ? 'var(--morph)' : 'var(--text-muted)'}
                      strokeOpacity={added ? 1 : 0.55}
                      strokeWidth={1.25}
                      strokeDasharray={added ? '4 3' : undefined}
                      markerEnd={`url(#${marker}-${added ? 'morph' : 'plain'})`}
                    />
                    {count !== null ? (
                      <text
                        x={x2 - 6}
                        y={y2 - 5}
                        textAnchor="end"
                        className="tabular-nums"
                        fontSize="9.5"
                        fill={added ? 'var(--morph)' : 'var(--text-muted)'}
                        stroke="var(--surface)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {count} 条
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </svg>
            {[...pos].map(([id, p]) => {
              const added = oldNodes ? !oldNodes.has(id) : false
              return (
                <div
                  key={id}
                  data-flow-node={id}
                  className={cn(
                    'absolute flex flex-col justify-center rounded-[var(--radius-control)] border px-2',
                    added ? 'border-dashed border-morph bg-morph-soft' : 'border-border bg-surface',
                    byId.get(id)?.hidden && 'opacity-50',
                  )}
                  style={{ left: p.x, top: p.y, width: W, height: H }}
                  title={`${label(id)}（${sub(id)}）`}
                >
                  <span className={cn('truncate text-[11px] font-medium', added && 'text-morph')}>
                    {label(id)}
                  </span>
                  <span className="truncate text-[10px] text-muted">{sub(id)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">组件之间还没有数据连接。</p>
      )}
      {detached.length ? (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
          不接数据流：
          {detached.map((id) => (
            <span
              key={id}
              className={cn(
                'rounded-full border px-2 py-0.5',
                oldNodes && !oldNodes.has(id) ? 'border-dashed border-morph text-morph' : 'border-border',
              )}
            >
              {label(id)} · {sub(id)}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}
