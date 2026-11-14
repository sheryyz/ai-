import { stableStringify } from './diff'
import { type EvalContext, evaluateFilter, type Row } from './filter'
import { type ParamsOf, REGISTRY } from './registry'
import {
  asRows,
  evaluateGraph,
  fieldTypesOf,
  materialize,
  primaryEntity,
  recordScope,
  type StoredRecord,
} from './runtime'
import type { AppDefinition } from './schema'

export interface ImpactRecord {
  id: string
  label: string
}
export interface BusinessState {
  count: number
  value: number | null
  matched: number | null
  format: 'number' | 'percent'
  records: ImpactRecord[]
  basis: string
}
export interface BusinessChange {
  nodeId: string
  label: string
  kind: string
  before: BusinessState | null
  after: BusinessState | null
  entered: ImpactRecord[]
  exited: ImpactRecord[]
  scopeChanged: boolean
}
export interface BusinessImpact {
  recordCount: number
  changes: BusinessChange[]
}

const SUPPORTED = new Set(['Table', 'CSVExport', 'MessageDraft', 'Metric', 'QuickAction'])

function states(def: AppDefinition | null, stored: StoredRecord[], ctx: EvalContext) {
  const result = new Map<string, { label: string; kind: string; state: BusinessState }>()
  if (!def) return result
  const entity = primaryEntity(def)
  const types = fieldTypesOf(entity)
  const rows = stored.map((r) => materialize(r, entity))
  const graph = evaluateGraph(def, rows, ctx)
  for (const node of def.nodes) {
    if (node.hidden || !SUPPORTED.has(node.type)) continue
    const ev = graph.get(node.id)
    let selected = asRows(ev?.inputs[node.type === 'MessageDraft' ? 'recipients' : 'rows'])
    let matched: number | null = null
    let value: number | null = null
    let format: BusinessState['format'] = 'number'
    const basis: unknown[] = [...recordScope(def, node.id)]
    if (node.type === 'QuickAction') {
      const { availableWhen } = node.params as ParamsOf<'QuickAction'>
      if (availableWhen) {
        selected = selected.filter((r) => evaluateFilter(availableWhen, r, types, ctx))
        basis.push(availableWhen)
      }
    }
    if (node.type === 'Metric') {
      const p = node.params as ParamsOf<'Metric'>
      const where = p.where
      matched = where ? selected.filter((r) => evaluateFilter(where, r, types, ctx)).length : null
      value = typeof ev?.outputs.value === 'number' ? ev.outputs.value : null
      format = p.format === 'percent' ? 'percent' : 'number'
      basis.push({ aggregate: p.aggregate, field: p.field, where })
    }
    const record = (r: Row): ImpactRecord => ({
      id: r.id,
      label: String(r.values[entity.displayField] ?? r.id),
    })
    result.set(node.id, {
      label: node.title ?? REGISTRY[node.type].label,
      kind: node.type,
      state: {
        count: selected.length,
        value,
        matched,
        format,
        records: selected.map(record),
        basis: stableStringify(basis),
      },
    })
  }
  return result
}

/** Both definitions run against the same records and business date. No writes or action execution. */
export function computeBusinessImpact(
  before: AppDefinition | null,
  after: AppDefinition,
  records: StoredRecord[],
  ctx: EvalContext,
): BusinessImpact {
  const a = states(before, records, ctx)
  const b = states(after, records, ctx)
  const changes: BusinessChange[] = []
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id)
    const next = b.get(id)
    const oldIds = new Set(old?.state.records.map((r) => r.id))
    const newIds = new Set(next?.state.records.map((r) => r.id))
    const entered = (next?.state.records ?? []).filter((r) => !oldIds.has(r.id))
    const exited = (old?.state.records ?? []).filter((r) => !newIds.has(r.id))
    const scopeChanged = old?.state.basis !== next?.state.basis
    if (
      old &&
      next &&
      old.kind === next.kind &&
      !scopeChanged &&
      !entered.length &&
      !exited.length &&
      old.state.value === next.state.value &&
      old.state.matched === next.state.matched
    )
      continue
    changes.push({
      nodeId: id,
      label: next?.label ?? old?.label ?? id,
      kind: next?.kind ?? old?.kind ?? '',
      before: old?.state ?? null,
      after: next?.state ?? null,
      entered,
      exited,
      scopeChanged,
    })
  }
  return { recordCount: records.length, changes }
}
