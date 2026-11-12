/**
 * Pure metric functions for the strategy evaluation (eval/README.md). Kept apart from the runner so the
 * definitions of "preserved" and "unrelated change" are unit-tested rather than only read in prose.
 */
import {
  type AppDefinition,
  coerceValue,
  computeDiff,
  destructiveSchemaIssues,
  type StoredRecord,
} from '@morphos/shared'

/**
 * A record is preserved when every non-empty value it holds is still readable, unchanged, under the new
 * definition: same entity id, a field with the same id and type, and (for enums) the option still exists.
 */
export function recordPreserved(rec: StoredRecord, before: AppDefinition, after: AppDefinition): boolean {
  const be = before.entities[0]
  const ae = after.entities.find((e) => e.id === be?.id)
  if (!be || !ae) return false
  for (const [key, value] of Object.entries(rec.data)) {
    if (value === null || value === undefined || value === '') continue
    const bf = be.fields.find((f) => f.id === key)
    const af = ae.fields.find((f) => f.id === key)
    if (!bf || !af || af.type !== bf.type) return false
    const c = coerceValue(value, af)
    if (!c.ok || c.value !== value) return false
  }
  return true
}

export function countPreserved(records: StoredRecord[], before: AppDefinition, after: AppDefinition): number {
  return records.filter((r) => recordPreserved(r, before, after)).length
}

/** Data-destroying schema changes (removed entity/field, changed type, removed option) as readable strings. */
export function destructiveChanges(before: AppDefinition, after: AppDefinition): string[] {
  return destructiveSchemaIssues(before, after).map((i) => i.message)
}

/**
 * Changes to pre-existing content that the request did not call for. Counted: changed / removed / hidden
 * nodes outside `allowTouch`, changed existing fields, rewired data connections between surviving nodes
 * outside `allowTouch`, and a changed app name or icon. Not counted: added content, pure layout moves and
 * the app description (patches routinely refresh it). Bindings are compared by endpoints, not ids.
 */
export function unrelatedChanges(
  before: AppDefinition,
  after: AppDefinition,
  allowTouch: string[],
): string[] {
  const allowed = new Set(allowTouch)
  const d = computeDiff(before, after, { fromVersion: 0, recordCount: 0 })
  const out: string[] = []
  for (const n of d.nodes.removed) if (!allowed.has(n.id)) out.push(`移除组件 ${n.id}`)
  for (const n of d.nodes.changed)
    if (!allowed.has(n.nodeId)) out.push(`修改组件 ${n.nodeId}（${n.keys.join('、')}）`)
  for (const id of d.nodes.hidden) if (!allowed.has(id)) out.push(`隐藏组件 ${id}`)
  for (const f of d.fields.changed)
    out.push(`修改字段 ${f.fieldId}（${f.changes.map((c) => c.key).join('、')}）`)

  const survivors = new Set(after.nodes.map((n) => n.id))
  const edge = (b: AppDefinition['bindings'][number]) =>
    `${b.from.node}.${b.from.port}→${b.to.node}.${b.to.port}`
  const afterEdges = new Set(after.bindings.map(edge))
  for (const b of before.bindings) {
    if (afterEdges.has(edge(b))) continue
    if (!survivors.has(b.from.node) || !survivors.has(b.to.node)) continue // counted as a removed node
    if (allowed.has(b.to.node)) continue
    out.push(`断开连接 ${edge(b)}`)
  }
  for (const k of d.app.changed)
    if (k !== 'description') out.push(`修改应用${k === 'name' ? '名称' : '图标'}`)
  return out
}

/** Nearest-rank percentile; NaN for an empty list. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number
}
