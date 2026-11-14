import { type EvalContext, evaluateFilter, type FilterExpr, type Row } from './filter'
import { type ParamsOf, REGISTRY } from './registry'
import { asRows, evaluateGraph, fieldTypesOf, materialize, primaryEntity, type StoredRecord } from './runtime'
import type { AppDefinition } from './schema'

export interface Explanation {
  nodeId: string
  label: string
  kind: string
  total: number
  inputCount: number
  result: number | null
  aggregate?: string
  field?: string
  where?: FilterExpr
  matched: number | null
  steps: { nodeId: string; label: string; condition: FilterExpr; before: number; after: number }[]
  records: {
    id: string
    label: string
    included: boolean
    checks: { label: string; condition: FilterExpr; passed: boolean }[]
  }[]
}

/** Admin-only explanation from the same evaluator, not model-generated reasoning. */
export function explainNode(
  def: AppDefinition,
  stored: StoredRecord[],
  nodeId: string,
  ctx: EvalContext,
): Explanation | null {
  const node = def.nodes.find((n) => n.id === nodeId)
  if (!node || !['Metric', 'MessageDraft', 'QuickAction', 'Table', 'CSVExport'].includes(node.type))
    return null
  const entity = primaryEntity(def)
  const types = fieldTypesOf(entity)
  const rows = stored.map((r) => materialize(r, entity))
  const graph = evaluateGraph(def, rows, ctx)
  const ev = graph.get(nodeId)
  const input = asRows(ev?.inputs[node.type === 'MessageDraft' ? 'recipients' : 'rows'])
  const filters: { nodeId: string; label: string; condition: FilterExpr }[] = []
  let current = node
  const seen = new Set<string>()
  while (!seen.has(current.id)) {
    seen.add(current.id)
    const port = REGISTRY[current.type].inputs.find((p) => p.type === 'RecordSet')
    const id = current.id
    const edge = port && def.bindings.find((b) => b.to.node === id && b.to.port === port.name)
    const upstream = edge && def.nodes.find((n) => n.id === edge.from.node)
    if (!upstream) break
    if (upstream.type === 'Filter')
      filters.unshift({
        nodeId: upstream.id,
        label: upstream.title ?? '筛选',
        condition: (upstream.params as ParamsOf<'Filter'>).filter,
      })
    current = upstream
  }
  const metric = node.type === 'Metric' ? (node.params as ParamsOf<'Metric'>) : null
  const action = node.type === 'QuickAction' ? (node.params as ParamsOf<'QuickAction'>) : null
  const where = metric?.where ?? action?.availableWhen
  const inputIds = new Set(input.map((r) => r.id))
  const passes = (condition: FilterExpr, r: Row) => evaluateFilter(condition, r, types, ctx)
  return {
    nodeId,
    label: node.title ?? REGISTRY[node.type].label,
    kind: node.type,
    total: rows.length,
    inputCount: input.length,
    result: typeof ev?.outputs.value === 'number' ? ev.outputs.value : null,
    aggregate: metric?.aggregate,
    field: metric?.field,
    where,
    matched: where ? input.filter((r) => passes(where, r)).length : null,
    steps: filters.map((f) => ({
      ...f,
      before: asRows(graph.get(f.nodeId)?.inputs.input).length,
      after: asRows(graph.get(f.nodeId)?.outputs.result).length,
    })),
    records: rows.map((r) => ({
      id: r.id,
      label: String(r.values[entity.displayField] ?? r.id),
      included: inputIds.has(r.id) && (!where || passes(where, r)),
      checks: [
        ...filters.map((f) => ({ label: f.label, condition: f.condition, passed: passes(f.condition, r) })),
        ...(where
          ? [{ label: metric ? '指标命中条件' : '操作可用条件', condition: where, passed: passes(where, r) }]
          : []),
      ],
    })),
  }
}
