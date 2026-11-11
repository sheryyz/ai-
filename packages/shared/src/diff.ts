/**
 * protocol.md §8 — Morph Diff computed from two *complete* definitions, never from the patch text,
 * so the user always sees the real effect regardless of how the model phrased its operations.
 */
import { REGISTRY } from './registry'
import type { AppDefinition, Binding, ComponentType, FieldDef, NodeDef, Region } from './schema'

export interface FieldChange {
  fieldId: string
  label: string
  changes: { key: 'label' | 'description' | 'options' | 'default'; before: unknown; after: unknown }[]
}
export interface NodeChange {
  nodeId: string
  type: ComponentType
  title?: string
  keys: string[]
}
export interface Placement {
  region: Region
  order: number | null
  width: 'full' | 'half'
}
export interface NodeMove {
  nodeId: string
  type: ComponentType
  title?: string
  from: Placement
  to: Placement
}
export type ImpactKind = 'defaultFill' | 'emptyFill' | 'nodeRemoved' | 'writeCapabilityRemoved'
export interface Impact {
  kind: ImpactKind
  severity: 'info' | 'warning' | 'danger'
  message: string
  fieldId?: string
  nodeId?: string
  affectedRecords?: number
}
export type Risk = 'low' | 'medium' | 'high'

export interface MorphDiff {
  fromVersion: number
  summary: string
  app: { changed: ('name' | 'description' | 'icon')[] }
  fields: { added: FieldDef[]; changed: FieldChange[] }
  nodes: {
    added: NodeDef[]
    removed: NodeDef[]
    changed: NodeChange[]
    moved: NodeMove[]
    hidden: string[]
    shown: string[]
  }
  bindings: { added: Binding[]; removed: Binding[] }
  preserved: { recordCount: number; fieldIds: string[] }
  impacts: Impact[]
  risk: Risk
  isEmpty: boolean
}

export interface DiffContext {
  fromVersion: number
  recordCount: number
}

/** Deterministic JSON for structural equality (key order independent). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`
  }
  return JSON.stringify(v)
}
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

const placement = (n: NodeDef): Placement => ({
  region: n.region ?? 'main',
  order: n.order ?? null,
  width: n.width ?? 'full',
})

export function computeDiff(before: AppDefinition | null, after: AppDefinition, ctx: DiffContext): MorphDiff {
  const bFields = before?.entities[0]?.fields ?? []
  const aFields = after.entities[0]?.fields ?? []
  const bNodes = new Map((before?.nodes ?? []).map((n) => [n.id, n]))
  const aNodes = new Map(after.nodes.map((n) => [n.id, n]))
  const bBind = new Map((before?.bindings ?? []).map((b) => [b.id, b]))
  const aBind = new Map(after.bindings.map((b) => [b.id, b]))

  const fieldsAdded = aFields.filter((f) => !bFields.some((x) => x.id === f.id))
  const fieldsChanged: FieldChange[] = []
  for (const bf of bFields) {
    const af = aFields.find((x) => x.id === bf.id)
    if (!af) continue
    const changes: FieldChange['changes'] = []
    for (const key of ['label', 'description', 'options', 'default'] as const) {
      if (!same(bf[key], af[key])) changes.push({ key, before: bf[key], after: af[key] })
    }
    if (changes.length) fieldsChanged.push({ fieldId: af.id, label: af.label, changes })
  }

  const added: NodeDef[] = []
  const changed: NodeChange[] = []
  const moved: NodeMove[] = []
  const hidden: string[] = []
  const shown: string[] = []
  for (const an of after.nodes) {
    const bn = bNodes.get(an.id)
    if (!bn || bn.type !== an.type) {
      added.push(an)
      continue
    }
    const keys = [
      ...(bn.title !== an.title ? ['title'] : []),
      ...[...new Set([...Object.keys(bn.params), ...Object.keys(an.params)])].filter(
        (k) => !same(bn.params[k], an.params[k]),
      ),
    ]
    if (keys.length) changed.push({ nodeId: an.id, type: an.type, title: an.title, keys })
    if (!same(placement(bn), placement(an))) {
      moved.push({ nodeId: an.id, type: an.type, title: an.title, from: placement(bn), to: placement(an) })
    }
    if (!bn.hidden && an.hidden) hidden.push(an.id)
    if (bn.hidden && !an.hidden) shown.push(an.id)
  }
  const removed = [...bNodes.values()].filter((bn) => {
    const an = aNodes.get(bn.id)
    return !an || an.type !== bn.type
  })

  const bindingsAdded = [...aBind.values()].filter((b) => !bBind.has(b.id) || !same(bBind.get(b.id), b))
  const bindingsRemoved = [...bBind.values()].filter((b) => !aBind.has(b.id) || !same(aBind.get(b.id), b))

  const appChanged = before
    ? (['name', 'description', 'icon'] as const).filter((k) => before[k] !== after[k])
    : []

  // ── impacts ───────────────────────────────────────────────────────────────
  const impacts: Impact[] = []
  if (before) {
    for (const f of fieldsAdded) {
      if (ctx.recordCount === 0) continue
      impacts.push(
        f.default !== undefined && f.default !== null
          ? {
              kind: 'defaultFill',
              severity: 'info',
              fieldId: f.id,
              affectedRecords: ctx.recordCount,
              message: `已有 ${ctx.recordCount} 条记录的「${f.label}」将显示默认值「${displayDefault(f)}」（读取时补齐，不改写数据库）`,
            }
          : {
              kind: 'emptyFill',
              severity: 'info',
              fieldId: f.id,
              affectedRecords: ctx.recordCount,
              message: `已有 ${ctx.recordCount} 条记录的「${f.label}」暂为空，可在表格中补充`,
            },
      )
    }
    for (const n of removed) {
      impacts.push({
        kind: 'nodeRemoved',
        severity: 'warning',
        nodeId: n.id,
        message: `移除组件「${n.title ?? REGISTRY[n.type].label}」，它展示或处理的业务记录不会被删除`,
      })
    }
  }
  const visibleForms = (d: AppDefinition | null) =>
    (d?.nodes ?? []).filter((n) => n.type === 'Form' && !n.hidden).length
  if (before && visibleForms(before) > 0 && visibleForms(after) === 0) {
    impacts.push({
      kind: 'writeCapabilityRemoved',
      severity: 'danger',
      message: '变更后应用中没有可见的表单，将无法录入新记录',
    })
  }

  const risk: Risk = impacts.some((i) => i.severity === 'danger')
    ? 'high'
    : removed.length || hidden.length || bindingsRemoved.length || fieldsChanged.length
      ? 'medium'
      : 'low'

  const isEmpty =
    !appChanged.length &&
    !fieldsAdded.length &&
    !fieldsChanged.length &&
    !added.length &&
    !removed.length &&
    !changed.length &&
    !moved.length &&
    !hidden.length &&
    !shown.length &&
    !bindingsAdded.length &&
    !bindingsRemoved.length

  const visibleAdded = added.filter((n) => REGISTRY[n.type].visual).length
  const summary = before
    ? summarize([
        [fieldsAdded.length, '新增', '个字段'],
        [visibleAdded, '新增', '个组件'],
        [bindingsAdded.length, '新增', '条数据连接'],
        [fieldsChanged.length, '修改', '个字段'],
        [changed.length, '调整', '个组件参数'],
        [moved.length, '移动', '个组件'],
        [hidden.length, '隐藏', '个组件'],
        [shown.length, '显示', '个组件'],
        [removed.length, '移除', '个组件'],
        [bindingsRemoved.length, '断开', '条数据连接'],
      ]) || (appChanged.length ? '修改应用信息' : '没有变化')
    : `创建「${after.name}」：${aFields.length} 个字段、${after.nodes.filter((n) => REGISTRY[n.type].visual).length} 个组件、${after.bindings.length} 条数据连接`

  return {
    fromVersion: ctx.fromVersion,
    summary,
    app: { changed: [...appChanged] },
    fields: { added: fieldsAdded, changed: fieldsChanged },
    nodes: { added, removed, changed, moved, hidden, shown },
    bindings: { added: bindingsAdded, removed: bindingsRemoved },
    preserved: { recordCount: ctx.recordCount, fieldIds: bFields.map((f) => f.id) },
    impacts,
    risk,
    isEmpty,
  }
}

function displayDefault(f: FieldDef): string {
  if (typeof f.default === 'boolean') return f.default ? '是' : '否'
  return String(f.default)
}

function summarize(parts: [number, string, string][]): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, verb, unit]) => `${verb} ${n} ${unit}`)
    .join('，')
}
