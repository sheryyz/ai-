/**
 * protocol.md §11 — role-view exposure. What a share page can read row by row, only aggregate, or write
 * is computed from its components and bindings, never taken from the model's own description.
 * The server trims share-page snapshots with the same functions (CLAUDE.md constraint 9).
 */
import { type FilterExpr, forEachCondition } from './filter'
import { RESERVED_FIELD_IDS, SYSTEM_FIELD_LABELS } from './ids'
import { issue, type ValidationIssue } from './issues'
import { type ParamsOf, REGISTRY } from './registry'
import { type AppDefinition, type EntityDef, type NodeDef, type ViewDef, viewsOf } from './schema'

export interface NodeExposure {
  /** Fields whose values reach the viewer record by record. */
  read: string[]
  /** Fields that only feed counts, ratios or groupings. */
  aggregate: string[]
  /** Fields the viewer can set (new records or preset quick actions). */
  write: string[]
  creates: boolean
}

export interface NodeScope extends NodeExposure {
  nodeId: string
  type: NodeDef['type']
  title?: string
  /** Titles of the Filters the node's records pass through, source first; empty = all records. */
  filters: string[]
}

export interface ViewExposure {
  viewId: string
  label: string
  audience: string
  read: string[]
  aggregate: string[]
  write: string[]
  canCreate: boolean
  sensitiveRead: string[]
  restricted: string[]
  nodes: NodeScope[]
}

const TEMPLATE_FIELD = /\{\{\s*([^}\s]+)\s*\}\}/g

/**
 * Which nodes (by index in `definition.nodes`) to consider. The validator passes "params parsed",
 * so L7 can run in the same round as structural errors on other nodes.
 */
export type NodeFilter = (index: number) => boolean
const ALL: NodeFilter = () => true

function entityOf(def: AppDefinition): EntityDef {
  // biome-ignore lint/style/noNonNullAssertion: AppDefinitionSchema guarantees one entity
  return def.entities[0]!
}

/** Entity fields first in declaration order, then system fields; unknown ids last. */
function ordered(ids: Iterable<string>, entity: EntityDef): string[] {
  const set = new Set(ids)
  const order = [...entity.fields.map((f) => f.id), ...RESERVED_FIELD_IDS]
  return [...order.filter((id) => set.has(id)), ...[...set].filter((id) => !order.includes(id))]
}

function filterFields(expr: FilterExpr | undefined): string[] {
  const out: string[] = []
  if (expr) forEachCondition(expr, (c) => out.push(c.field))
  return out
}

export function fieldLabelOf(entity: EntityDef, id: string): string {
  return entity.fields.find((f) => f.id === id)?.label ?? SYSTEM_FIELD_LABELS[id] ?? id
}

export function sensitiveFieldIds(def: AppDefinition): string[] {
  return entityOf(def)
    .fields.filter((f) => f.sensitive)
    .map((f) => f.id)
}

/** protocol §11.1 table: what one component exposes, independent of which page it is on. */
export function nodeExposure(node: NodeDef, entity: EntityDef): NodeExposure {
  const read: string[] = []
  const aggregate: string[] = []
  const write: string[] = []
  let creates = false
  switch (node.type) {
    case 'Table': {
      const p = node.params as ParamsOf<'Table'>
      read.push(...p.columns)
      if (p.editable) write.push(...p.columns.filter((c) => entity.fields.some((f) => f.id === c)))
      break
    }
    case 'QuickAction': {
      const p = node.params as ParamsOf<'QuickAction'>
      read.push(entity.displayField, ...p.searchFields)
      write.push(...Object.keys(p.set), ...(p.ask ?? []))
      break
    }
    case 'MessageDraft': {
      const p = node.params as ParamsOf<'MessageDraft'>
      read.push(entity.displayField)
      for (const m of p.template.matchAll(TEMPLATE_FIELD)) if (m[1]) read.push(m[1])
      break
    }
    case 'CSVExport': {
      const p = node.params as ParamsOf<'CSVExport'>
      // Same default as runtime.defaultColumns: omitting columns exports every field.
      read.push(...(p.columns ?? [...entity.fields.map((f) => f.id), 'createdAt']))
      break
    }
    case 'Form': {
      write.push(...(node.params as ParamsOf<'Form'>).fields)
      creates = true
      break
    }
    case 'Metric': {
      const p = node.params as ParamsOf<'Metric'>
      if (p.field) aggregate.push(p.field)
      aggregate.push(...filterFields(p.where))
      break
    }
    case 'Chart': {
      aggregate.push((node.params as ParamsOf<'Chart'>).groupBy)
      break
    }
    case 'Filter':
    case 'CollectionSource':
      break
  }
  return {
    read: ordered(read, entity),
    aggregate: ordered(aggregate, entity),
    write: ordered(write, entity),
    creates,
  }
}

/** Titles of the Filters between a node and its CollectionSource, following its record input upstream. */
export function upstreamFilters(def: AppDefinition, nodeId: string): string[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const out: string[] = []
  const seen = new Set<string>([nodeId])
  let current = byId.get(nodeId)
  while (current) {
    const port = REGISTRY[current.type].inputs.find((p) => p.type === 'RecordSet')
    const id = current.id
    const edge = port && def.bindings.find((b) => b.to.node === id && b.to.port === port.name)
    if (!edge || seen.has(edge.from.node)) break
    seen.add(edge.from.node)
    current = byId.get(edge.from.node)
    if (current?.type === 'Filter') out.unshift(current.title ?? REGISTRY.Filter.label)
  }
  return out
}

/** Visible components of a role view, in page order (protocol §3.1: single column by `order`). */
export function viewNodes(def: AppDefinition, viewId: string, include: NodeFilter = ALL): NodeDef[] {
  return def.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => n.view === viewId && !n.hidden && REGISTRY[n.type].visual && include(i))
    .sort((a, b) => (a.n.order ?? 500 + a.i) - (b.n.order ?? 500 + b.i) || a.i - b.i)
    .map(({ n }) => n)
}

export function computeExposure(
  def: AppDefinition,
  viewId: string,
  include: NodeFilter = ALL,
): ViewExposure | undefined {
  const view = viewsOf(def).find((v) => v.id === viewId)
  if (!view) return undefined
  const entity = entityOf(def)
  const nodes: NodeScope[] = viewNodes(def, viewId, include).map((n) => ({
    nodeId: n.id,
    type: n.type,
    ...(n.title ? { title: n.title } : {}),
    ...nodeExposure(n, entity),
    filters: n.type === 'Form' ? [] : upstreamFilters(def, n.id),
  }))
  const read = ordered(
    nodes.flatMap((n) => n.read),
    entity,
  )
  const sensitive = new Set(sensitiveFieldIds(def))
  return {
    viewId: view.id,
    label: view.label,
    audience: view.audience,
    read,
    aggregate: ordered(
      nodes.flatMap((n) => n.aggregate).filter((f) => !read.includes(f)),
      entity,
    ),
    write: ordered(
      nodes.flatMap((n) => n.write),
      entity,
    ),
    canCreate: nodes.some((n) => n.creates),
    sensitiveRead: read.filter((f) => sensitive.has(f)),
    restricted: ordered(view.restrictedFields ?? [], entity),
    nodes,
  }
}

/** protocol §11.2 — L7 exposure rules over a definition that already passed L1–L4. */
export function exposureIssues(def: AppDefinition, include: NodeFilter = ALL): ValidationIssue[] {
  const entity = entityOf(def)
  const label = (id: string) => fieldLabelOf(entity, id)
  const out: ValidationIssue[] = []
  viewsOf(def).forEach((view: ViewDef, vi) => {
    const restricted = new Set(view.restrictedFields ?? [])
    const page = `分享页「${view.label}」`
    def.nodes.forEach((n, i) => {
      if (n.view !== view.id || n.hidden || !REGISTRY[n.type].visual || !include(i)) return
      const name = `「${n.title ?? REGISTRY[n.type].label}」`
      if (n.type === 'Table') {
        const p = n.params as ParamsOf<'Table'>
        for (const key of ['editable', 'allowDelete'] as const) {
          if (!p[key]) continue
          out.push(
            issue(
              'exposure',
              'EXPOSURE_FREE_EDIT',
              ['nodes', i, 'params', key],
              `${page}中的表格${name}不能${key === 'editable' ? '开启编辑' : '允许删除'}：持链接的人只能新增记录或执行预设的快捷操作`,
              '去掉 editable / allowDelete（视图中的表格默认只读）；需要改某个字段时，改用 QuickAction 限定字段与取值',
            ),
          )
        }
      }
      if (!restricted.size) return
      const e = nodeExposure(n, entity)
      for (const [kind, ids] of [
        ['逐条看到', e.read],
        ['修改', e.write],
      ] as const) {
        for (const id of ids.filter((f) => restricted.has(f))) {
          const exportAll = n.type === 'CSVExport' && !(n.params as ParamsOf<'CSVExport'>).columns
          out.push(
            issue(
              'exposure',
              'EXPOSURE_RESTRICTED_FIELD',
              ['nodes', i, 'params'],
              `${page}已禁止${view.audience}接触「${label(id)}」，组件${name}会让其${kind}该字段`,
              exportAll
                ? `导出组件省略 columns 时会导出全部字段；请显式列出 columns，并去掉 ${id}`
                : `从该组件的参数中去掉 ${id}；如果只需要统计，可改用 Metric 或 Chart`,
            ),
          )
        }
      }
    })
    const exposure = computeExposure(def, view.id, include)
    if (!exposure) return
    if (!exposure.nodes.length) {
      out.push(
        issue(
          'exposure',
          'EXPOSURE_VIEW_EMPTY',
          ['views', vi],
          `${page}还没有可见的组件，打开链接会显示“此页面已停用”`,
          `用 addNode 添加 view 为 "${view.id}" 的组件`,
          'warning',
        ),
      )
    }
    if (exposure.sensitiveRead.length) {
      out.push(
        issue(
          'exposure',
          'EXPOSURE_SENSITIVE_FIELD',
          ['views', vi],
          `${page}会让${view.audience}逐条看到敏感字段：${exposure.sensitiveRead.map(label).join('、')}`,
          '如果不需要，从相关组件中去掉这些字段；确需公开时，批准前需要组织者确认',
          'warning',
        ),
      )
    }
  })
  return out
}
