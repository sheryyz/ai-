/**
 * protocol.md §11.4 — what a share page receives. The server evaluates the whole graph, then gives each
 * component of the view only what it displays: the row-level fields it reads, or precomputed statistics.
 * Statistics are never sent as rows, so a viewer cannot line them up with another component's rows.
 */
import { filterFieldIds, nodeExposure, viewNodes } from './exposure'
import { type EvalContext, evaluateFilter, type FieldValue, type Row } from './filter'
import type { ParamsOf } from './registry'
import { asRows, evaluateGraph, fieldTypesOf, type Group, groupCounts } from './runtime'
import { type AppDefinition, type EntityDef, type NodeDef, viewsOf } from './schema'

export type ViewNodeData =
  | { kind: 'form' }
  | { kind: 'rows'; rows: Row[] }
  | { kind: 'count'; count: number; total: number }
  | { kind: 'metric'; value: number | null; matched: number | null; count: number }
  | { kind: 'groups'; groups: Group[] }

export interface ViewNodeSnapshot {
  node: NodeDef
  data: ViewNodeData
}

/** Keeps the record id (needed to act on it) and only the given fields; timestamps only when read. */
export function trimRow(r: Row, read: readonly string[]): Row {
  const values: Record<string, FieldValue> = {}
  for (const id of read) {
    const v = r.values[id]
    if (v !== undefined) values[id] = v
  }
  return {
    id: r.id,
    createdAt: read.includes('createdAt') ? r.createdAt : '',
    updatedAt: read.includes('updatedAt') ? r.updatedAt : '',
    values,
  }
}

export function snapshotView(
  def: AppDefinition,
  viewId: string,
  rows: Row[],
  ctx: EvalContext,
): { entity: EntityDef; nodes: ViewNodeSnapshot[] } | undefined {
  if (!viewsOf(def).some((v) => v.id === viewId)) return undefined
  // biome-ignore lint/style/noNonNullAssertion: AppDefinitionSchema guarantees one entity
  const entity = def.entities[0]!
  const types = fieldTypesOf(entity)
  const graph = evaluateGraph(def, rows, ctx)
  const used = new Set<string>([entity.displayField])

  const nodes = viewNodes(def, viewId).map((n): ViewNodeSnapshot => {
    const e = nodeExposure(n, entity)
    for (const id of [...e.read, ...e.aggregate, ...e.write]) used.add(id)
    const ev = graph.get(n.id)
    const input = (port: string) => asRows(ev?.inputs[port])
    const trim = (list: Row[]) => list.map((r) => trimRow(r, e.read))
    switch (n.type) {
      case 'Form':
        return { node: n, data: { kind: 'form' } }
      case 'Table':
        return { node: n, data: { kind: 'rows', rows: trim(input('rows')) } }
      case 'MessageDraft':
        return { node: n, data: { kind: 'rows', rows: trim(input('recipients')) } }
      case 'QuickAction': {
        // Eligibility is decided here, so the fields behind `availableWhen` never leave the server.
        const { availableWhen, ...params } = n.params as ParamsOf<'QuickAction'>
        const eligible = availableWhen
          ? input('rows').filter((r) => evaluateFilter(availableWhen, r, types, ctx))
          : input('rows')
        return { node: { ...n, params }, data: { kind: 'rows', rows: trim(eligible) } }
      }
      case 'CSVExport': {
        const count = input('rows').length
        return { node: n, data: { kind: 'count', count, total: count } }
      }
      case 'Filter': {
        // Condition chips need the field labels, not the values.
        for (const id of filterFieldIds((n.params as ParamsOf<'Filter'>).filter)) used.add(id)
        const result = asRows(ev?.outputs.result).length
        return { node: n, data: { kind: 'count', count: result, total: input('input').length } }
      }
      case 'Metric': {
        const p = n.params as ParamsOf<'Metric'>
        const list = input('rows')
        const where = p.where
        return {
          node: n,
          data: {
            kind: 'metric',
            value: typeof ev?.outputs.value === 'number' ? ev.outputs.value : null,
            matched: where ? list.filter((r) => evaluateFilter(where, r, types, ctx)).length : null,
            count: list.length,
          },
        }
      }
      case 'Chart': {
        const field = entity.fields.find((f) => f.id === (n.params as ParamsOf<'Chart'>).groupBy)
        return { node: n, data: { kind: 'groups', groups: field ? groupCounts(input('rows'), field) : [] } }
      }
      default:
        // CollectionSource has no UI and never belongs to a view (REF_VIEW_NOT_ALLOWED).
        return { node: n, data: { kind: 'count', count: 0, total: 0 } }
    }
  })

  return { entity: { ...entity, fields: entity.fields.filter((f) => used.has(f.id)) }, nodes }
}
