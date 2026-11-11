/**
 * protocol.md §7 — definition validation, layers L1–L4.
 * Proposal-level layers (L5 safety, L6 version) live in proposal.ts.
 */
import {
  type FieldType,
  type FilterExpr,
  forEachCondition,
  isDateString,
  isRelativeDate,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
} from './filter'
import { isReservedFieldId } from './ids'
import { hasErrors, issue, type Layer, sortIssues, type ValidationIssue, zodIssues } from './issues'
import { DATE_TOKENS, getPort, PARAM_SCHEMAS, type ParamsOf, type PortDef, REGISTRY } from './registry'
import {
  type AppDefinition,
  AppDefinitionSchema,
  type ComponentType,
  type EntityDef,
  FIELD_TYPE_LABELS,
  type FieldDef,
  type NodeDef,
} from './schema'

export interface DefinitionValidation {
  ok: boolean
  issues: ValidationIssue[]
  /** Normalized definition (component params with defaults filled). Present when L1 passed. */
  definition?: AppDefinition
}

type Path = (string | number)[]
type ValueType = FieldType | 'timestamp'

export function validateDefinition(raw: unknown): DefinitionValidation {
  const parsed = AppDefinitionSchema.safeParse(structuredClone(raw))
  if (!parsed.success) return { ok: false, issues: sortIssues(zodIssues(parsed.error, [])) }
  const def = parsed.data
  const issues: ValidationIssue[] = []
  const add = (
    layer: Layer,
    code: string,
    path: Path,
    message: string,
    hint?: string,
    level: 'error' | 'warning' = 'error',
  ) => issues.push(issue(layer, code, path, message, hint, level))

  // ── L1: per-component params ──────────────────────────────────────────────
  const validParams = new Set<number>()
  def.nodes.forEach((n, i) => {
    const r = PARAM_SCHEMAS[n.type].safeParse(n.params)
    if (r.success) {
      n.params = r.data as Record<string, unknown>
      validParams.add(i)
    } else {
      issues.push(...zodIssues(r.error, ['nodes', i, 'params']))
    }
  })

  // biome-ignore lint/style/noNonNullAssertion: schema guarantees exactly one entity
  const entity = def.entities[0]!
  const fields = new Map<string, FieldDef>()
  const fieldList = () => entity.fields.map((f) => `${f.id}(${f.label})`).join('、')

  // ── L2/L3: entity & fields ────────────────────────────────────────────────
  entity.fields.forEach((f, i) => {
    const p: Path = ['entities', 0, 'fields', i]
    if (isReservedFieldId(f.id)) {
      add('reference', 'REF_RESERVED_ID', [...p, 'id'], `字段标识符「${f.id}」是系统保留字段`, '换一个标识符')
      return
    }
    if (fields.has(f.id)) {
      add('reference', 'REF_DUPLICATE_ID', [...p, 'id'], `字段标识符「${f.id}」重复`)
      return
    }
    fields.set(f.id, f)
    checkFieldDef(f, p, add)
  })

  const display = fields.get(entity.displayField)
  if (!display) {
    add(
      'reference',
      'REF_MISSING_FIELD',
      ['entities', 0, 'displayField'],
      `displayField「${entity.displayField}」不存在`,
      `可用字段：${fieldList()}`,
    )
  } else if (display.type !== 'string') {
    add(
      'type',
      'TYPE_DISPLAY_FIELD',
      ['entities', 0, 'displayField'],
      `displayField 必须是短文本字段，「${display.label}」是${FIELD_TYPE_LABELS[display.type]}`,
    )
  }

  /** Returns the value type of a referenced field, or undefined after reporting a reference issue. */
  const ref = (path: Path, id: string, allowReserved: boolean): ValueType | undefined => {
    if (isReservedFieldId(id)) {
      if (allowReserved) return id === 'id' ? 'string' : 'timestamp'
      add('reference', 'REF_RESERVED_ID', path, `此处不能使用系统字段「${id}」`, `可用字段：${fieldList()}`)
      return undefined
    }
    const f = fields.get(id)
    if (!f) {
      add(
        'reference',
        'REF_MISSING_FIELD',
        path,
        `字段「${id}」不存在于实体「${entity.label}」`,
        `可用字段：${fieldList()}`,
      )
      return undefined
    }
    return f.type
  }

  const checkFilter = (expr: FilterExpr, base: Path) => {
    forEachCondition(expr, (c, p) => {
      const path = [...base, ...p]
      const t = ref([...path, 'field'], c.field, true)
      if (!t) return
      const allowed = OPERATORS_BY_TYPE[t === 'timestamp' ? 'date' : t]
      const label = fields.get(c.field)?.label ?? c.field
      if (!allowed.includes(c.operator)) {
        add(
          'type',
          'TYPE_OPERATOR_INVALID',
          [...path, 'operator'],
          `字段「${label}」(${t === 'timestamp' ? '时间' : FIELD_TYPE_LABELS[t]}) 不支持操作符 ${c.operator}(${OPERATOR_LABELS[c.operator]})`,
          `可用操作符：${allowed.join(' / ')}`,
        )
        return
      }
      if (c.operator === 'isEmpty' || c.operator === 'notEmpty') return
      const values = Array.isArray(c.value) ? c.value : [c.value]
      values.forEach((v, j) => {
        const vp = Array.isArray(c.value) ? [...path, 'value', j] : [...path, 'value']
        const problem = filterValueProblem(v, t, fields.get(c.field))
        if (problem)
          add('type', problem.code, vp, `字段「${label}」的筛选值无效：${problem.message}`, problem.hint)
      })
    })
  }

  // ── L2: node ids ──────────────────────────────────────────────────────────
  const nodes = new Map<string, { node: NodeDef; index: number }>()
  def.nodes.forEach((n, i) => {
    if (nodes.has(n.id)) add('reference', 'REF_DUPLICATE_ID', ['nodes', i, 'id'], `节点标识符「${n.id}」重复`)
    else nodes.set(n.id, { node: n, index: i })
  })

  // ── L2/L3: node params ────────────────────────────────────────────────────
  def.nodes.forEach((n, i) => {
    if (!validParams.has(i)) return
    const p: Path = ['nodes', i, 'params']
    switch (n.type) {
      case 'CollectionSource': {
        const params = n.params as ParamsOf<'CollectionSource'>
        checkEntityId(params.entityId, entity, [...p, 'entityId'], add)
        if (params.sort) ref([...p, 'sort', 'field'], params.sort.field, true)
        break
      }
      case 'Form': {
        const params = n.params as ParamsOf<'Form'>
        checkEntityId(params.entityId, entity, [...p, 'entityId'], add)
        params.fields.forEach((id, j) => {
          ref([...p, 'fields', j], id, false)
        })
        warnDuplicates(params.fields, [...p, 'fields'], add)
        const missing = entity.fields.filter(
          (f) => f.required && f.default === undefined && !params.fields.includes(f.id),
        )
        if (missing.length) {
          add(
            'type',
            'TYPE_FORM_MISSING_REQUIRED',
            [...p, 'fields'],
            `表单缺少必填字段：${missing.map((f) => `${f.id}(${f.label})`).join('、')}，提交将无法通过校验`,
            '把这些字段加入 fields，或为字段设置 default',
          )
        }
        break
      }
      case 'Table': {
        const params = n.params as ParamsOf<'Table'>
        params.columns.forEach((id, j) => {
          ref([...p, 'columns', j], id, true)
        })
        warnDuplicates(params.columns, [...p, 'columns'], add)
        break
      }
      case 'CSVExport': {
        const params = n.params as ParamsOf<'CSVExport'>
        params.columns?.forEach((id, j) => {
          ref([...p, 'columns', j], id, true)
        })
        break
      }
      case 'Filter': {
        checkFilter((n.params as ParamsOf<'Filter'>).filter, [...p, 'filter'])
        break
      }
      case 'Metric': {
        const params = n.params as ParamsOf<'Metric'>
        if (['sum', 'avg', 'min', 'max'].includes(params.aggregate)) {
          if (!params.field) {
            add(
              'type',
              'TYPE_METRIC_FIELD',
              [...p, 'field'],
              `aggregate=${params.aggregate} 需要指定数字字段 field`,
            )
          } else {
            const t = ref([...p, 'field'], params.field, false)
            if (t && t !== 'number') {
              add(
                'type',
                'TYPE_METRIC_FIELD',
                [...p, 'field'],
                `aggregate=${params.aggregate} 只能用于数字字段，「${params.field}」是${FIELD_TYPE_LABELS[t as FieldType]}`,
                '改用 count，或换一个数字字段',
              )
            }
          }
        }
        if (params.aggregate === 'ratio' && !params.where) {
          add(
            'type',
            'TYPE_METRIC_WHERE_MISSING',
            [...p, 'where'],
            'aggregate=ratio 需要 where 作为分子条件',
            '例如签到率：where = {field:"checkedIn", operator:"eq", value:true}',
          )
        }
        if (params.where) checkFilter(params.where, [...p, 'where'])
        break
      }
      case 'Chart': {
        const params = n.params as ParamsOf<'Chart'>
        const t = ref([...p, 'groupBy'], params.groupBy, false)
        if (t && !['enum', 'boolean', 'string'].includes(t)) {
          add(
            'type',
            'TYPE_CHART_GROUPBY',
            [...p, 'groupBy'],
            `分布图只能按单选、是/否或短文本字段分组，「${params.groupBy}」是${FIELD_TYPE_LABELS[t as FieldType]}`,
          )
        }
        break
      }
      case 'QuickAction': {
        const params = n.params as ParamsOf<'QuickAction'>
        params.searchFields.forEach((id, j) => {
          ref([...p, 'searchFields', j], id, true)
        })
        params.ask?.forEach((id, j) => {
          ref([...p, 'ask', j], id, false)
        })
        for (const [key, value] of Object.entries(params.set)) {
          const t = ref([...p, 'set', key], key, false)
          const f = fields.get(key)
          if (!t || !f) continue
          const problem = fieldValueProblem(value, f, true)
          if (problem)
            add(
              'type',
              problem.code,
              [...p, 'set', key],
              `「${f.label}」的设置值无效：${problem.message}`,
              problem.hint,
            )
        }
        if (params.availableWhen) checkFilter(params.availableWhen, [...p, 'availableWhen'])
        break
      }
      case 'MessageDraft': {
        const params = n.params as ParamsOf<'MessageDraft'>
        for (const m of params.template.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
          // biome-ignore lint/style/noNonNullAssertion: capture group 1 always exists
          ref([...p, 'template'], m[1]!, true)
        }
        break
      }
    }
  })

  // ── L2/L3: bindings ───────────────────────────────────────────────────────
  const bindingIds = new Set<string>()
  const goodEdges: { from: string; to: string; toPort: string; index: number }[] = []
  def.bindings.forEach((b, i) => {
    const p: Path = ['bindings', i]
    if (bindingIds.has(b.id)) add('reference', 'REF_DUPLICATE_ID', [...p, 'id'], `绑定标识符「${b.id}」重复`)
    bindingIds.add(b.id)
    const from = nodes.get(b.from.node)
    const to = nodes.get(b.to.node)
    if (!from)
      add('reference', 'REF_MISSING_NODE', [...p, 'from', 'node'], `绑定起点节点「${b.from.node}」不存在`)
    if (!to) add('reference', 'REF_MISSING_NODE', [...p, 'to', 'node'], `绑定终点节点「${b.to.node}」不存在`)
    if (!from || !to) return
    const out = portOrIssue(from.node.type, 'output', b.from.port, [...p, 'from', 'port'], b.from.node, add)
    const inp = portOrIssue(to.node.type, 'input', b.to.port, [...p, 'to', 'port'], b.to.node, add)
    if (!out || !inp) return
    if (out.type !== inp.type) {
      add(
        'type',
        'TYPE_PORT_MISMATCH',
        p,
        `端口类型不匹配：${b.from.node}.${out.name} 输出 ${portTypeLabel(out, entity)}，而 ${b.to.node}.${inp.name} 需要 ${portTypeLabel(inp, entity)}`,
        inp.type === 'RecordSet' ? '记录类输入只能连接 CollectionSource.records 或 Filter.result' : undefined,
      )
      return
    }
    if (b.from.node === b.to.node) {
      add('graph', 'GRAPH_CYCLE', p, `节点「${b.from.node}」不能绑定到自身`)
      return
    }
    goodEdges.push({ from: b.from.node, to: b.to.node, toPort: inp.name, index: i })
  })

  // ── L4: graph ─────────────────────────────────────────────────────────────
  const sourceId = def.nodes.find((n) => n.type === 'CollectionSource')?.id
  def.nodes.forEach((n, i) => {
    for (const port of REGISTRY[n.type].inputs) {
      const incoming = goodEdges.filter((e) => e.to === n.id && e.toPort === port.name)
      if (port.required && incoming.length === 0) {
        add(
          'graph',
          'GRAPH_INPUT_UNBOUND',
          ['nodes', i],
          `节点「${n.id}」(${REGISTRY[n.type].label}) 的输入端口 ${port.name} 未连接`,
          sourceId
            ? `添加绑定 {from:{node:"${sourceId}",port:"records"}, to:{node:"${n.id}",port:"${port.name}"}}`
            : '先添加一个 CollectionSource 节点，再把它的 records 绑定到此端口',
        )
      }
      const extra = incoming[1]
      if (extra) {
        add(
          'graph',
          'GRAPH_INPUT_MULTI',
          ['bindings', extra.index],
          `节点「${n.id}」的输入端口 ${port.name} 只能接 1 条绑定，当前有 ${incoming.length} 条`,
        )
      }
    }
    if (n.type === 'CollectionSource' && !goodEdges.some((e) => e.from === n.id)) {
      add(
        'graph',
        'GRAPH_UNUSED_SOURCE',
        ['nodes', i],
        `数据源「${n.id}」没有连接任何组件`,
        undefined,
        'warning',
      )
    }
  })
  const cycle = findCycle(
    def.nodes.map((n) => n.id),
    goodEdges,
  )
  if (cycle) {
    add('graph', 'GRAPH_CYCLE', ['bindings'], `数据流存在环：${cycle.join(' → ')}`, '删除环上的任意一条绑定')
  }

  const sorted = sortIssues(issues)
  return { ok: !hasErrors(sorted), issues: sorted, definition: def }
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Add = (
  layer: Layer,
  code: string,
  path: Path,
  message: string,
  hint?: string,
  level?: 'error' | 'warning',
) => void

interface Problem {
  code: string
  message: string
  hint?: string
}

function checkFieldDef(f: FieldDef, p: Path, add: Add) {
  if (f.type === 'enum') {
    if (!f.options?.length) {
      add('type', 'TYPE_ENUM_OPTIONS_MISSING', [...p, 'options'], `单选字段「${f.label}」缺少 options`)
    } else if (new Set(f.options).size !== f.options.length) {
      add('type', 'TYPE_ENUM_OPTIONS_DUPLICATE', [...p, 'options'], `单选字段「${f.label}」的选项重复`)
    }
  } else if (f.options) {
    add(
      'type',
      'TYPE_OPTIONS_IGNORED',
      [...p, 'options'],
      `非单选字段「${f.label}」的 options 将被忽略`,
      undefined,
      'warning',
    )
  }
  if (f.default !== undefined) {
    const problem = fieldValueProblem(f.default, f, false)
    if (problem)
      add(
        'type',
        'TYPE_DEFAULT_INVALID',
        [...p, 'default'],
        `「${f.label}」的默认值无效：${problem.message}`,
        problem.hint,
      )
  }
}

function checkEntityId(id: string, entity: EntityDef, path: Path, add: Add) {
  if (id !== entity.id) {
    add('reference', 'REF_MISSING_ENTITY', path, `实体「${id}」不存在`, `当前应用的实体是「${entity.id}」`)
  }
}

function warnDuplicates(ids: string[], path: Path, add: Add) {
  if (new Set(ids).size !== ids.length)
    add('type', 'TYPE_DUPLICATE_COLUMN', path, '列表中有重复字段', undefined, 'warning')
}

function portOrIssue(
  type: ComponentType,
  direction: 'input' | 'output',
  name: string,
  path: Path,
  nodeId: string,
  add: Add,
): PortDef | undefined {
  const port = getPort(type, direction, name)
  if (port) return port
  const opposite = getPort(type, direction === 'input' ? 'output' : 'input', name)
  const spec = REGISTRY[type]
  const available = (direction === 'input' ? spec.inputs : spec.outputs).map((x) => x.name)
  if (opposite) {
    add(
      'type',
      'TYPE_PORT_DIRECTION',
      path,
      `端口方向错误：${nodeId}.${name} 是${direction === 'input' ? '输出' : '输入'}端口`,
      available.length
        ? `此处可用的${direction === 'input' ? '输入' : '输出'}端口：${available.join('、')}`
        : undefined,
    )
  } else {
    add(
      'type',
      'TYPE_PORT_MISSING',
      path,
      `${spec.label}「${nodeId}」没有名为 ${name} 的${direction === 'input' ? '输入' : '输出'}端口`,
      available.length
        ? `可用端口：${available.join('、')}`
        : `${spec.label}没有${direction === 'input' ? '输入' : '输出'}端口`,
    )
  }
  return undefined
}

function portTypeLabel(port: PortDef, entity: EntityDef): string {
  return port.type === 'RecordSet' ? `RecordSet<${entity.id}>` : 'Number'
}

/** Checks a concrete value for a field (defaults, QuickAction.set). */
export function fieldValueProblem(v: unknown, f: FieldDef, allowTokens: boolean): Problem | undefined {
  if (v === null) {
    return f.required ? { code: 'TYPE_VALUE_INVALID', message: '必填字段不能为空' } : undefined
  }
  switch (f.type) {
    case 'string':
    case 'text':
      return typeof v === 'string' ? undefined : { code: 'TYPE_VALUE_INVALID', message: '应为文本' }
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
        ? undefined
        : { code: 'TYPE_VALUE_INVALID', message: '应为数字' }
    case 'boolean':
      return typeof v === 'boolean'
        ? undefined
        : { code: 'TYPE_VALUE_INVALID', message: '应为 true 或 false' }
    case 'date':
      if (isDateString(v)) return undefined
      if (allowTokens && (DATE_TOKENS as readonly unknown[]).includes(v)) return undefined
      return {
        code: 'TYPE_VALUE_INVALID',
        message: '应为 YYYY-MM-DD 格式的日期',
        hint: allowTokens ? '也可使用 "$today" 表示执行当天' : undefined,
      }
    case 'enum':
      return typeof v === 'string' && f.options?.includes(v)
        ? undefined
        : {
            code: 'TYPE_ENUM_VALUE_INVALID',
            message: `「${String(v)}」不在选项中`,
            hint: `可选值：${f.options?.join(' / ') ?? '（无）'}`,
          }
  }
}

function filterValueProblem(v: unknown, t: ValueType, f: FieldDef | undefined): Problem | undefined {
  if (isRelativeDate(v)) {
    return t === 'date' || t === 'timestamp'
      ? undefined
      : { code: 'TYPE_VALUE_INVALID', message: '相对日期只能用于日期字段' }
  }
  if (v === null || v === undefined) {
    return {
      code: 'TYPE_VALUE_INVALID',
      message: '筛选值不能为空',
      hint: '判断是否为空请用 isEmpty / notEmpty',
    }
  }
  if (t === 'timestamp') {
    return isDateString(v)
      ? undefined
      : { code: 'TYPE_VALUE_INVALID', message: '应为 YYYY-MM-DD 日期或相对日期' }
  }
  if (!f) return undefined
  return fieldValueProblem(v, { ...f, required: true }, false)
}

/** Returns one cycle as a node path (first node repeated at the end), or undefined. */
function findCycle(ids: string[], edges: { from: string; to: string }[]): string[] | undefined {
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) adj.get(e.from)?.push(e.to)
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const dfs = (id: string): string[] | undefined => {
    state.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next]
      if (!state.get(next)) {
        const found = dfs(next)
        if (found) return found
      }
    }
    stack.pop()
    state.set(id, 2)
    return undefined
  }
  for (const id of ids) {
    if (!state.get(id)) {
      const found = dfs(id)
      if (found) return found
    }
  }
  return undefined
}

/** Topological order of node ids following bindings (assumes the definition is valid / acyclic). */
export function topoOrder(def: AppDefinition): string[] {
  const indeg = new Map(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]))
  for (const b of def.bindings) {
    if (!indeg.has(b.from.node) || !indeg.has(b.to.node)) continue
    adj.get(b.from.node)?.push(b.to.node)
    indeg.set(b.to.node, (indeg.get(b.to.node) ?? 0) + 1)
  }
  const queue = def.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const out: string[] = []
  while (queue.length) {
    // biome-ignore lint/style/noNonNullAssertion: queue non-empty
    const id = queue.shift()!
    out.push(id)
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1
      indeg.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  return out
}
