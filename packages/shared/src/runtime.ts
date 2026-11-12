/**
 * Runtime evaluation shared by server and web: record materialization (virtual default fill),
 * record input validation, binding-graph evaluation, aggregates, grouping, templates and CSV.
 */
import {
  type EvalContext,
  evaluateFilter,
  type FieldType,
  type FieldValue,
  getRowValue,
  isDateString,
  type Row,
} from './filter'
import { isReservedFieldId, SYSTEM_FIELD_LABELS } from './ids'
import { DATE_TOKENS, type ParamsOf, REGISTRY } from './registry'
import type { AppDefinition, EntityDef, FieldDef, NodeDef } from './schema'
import { topoOrder } from './validate'

export interface StoredRecord {
  id: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export function primaryEntity(def: AppDefinition): EntityDef {
  // biome-ignore lint/style/noNonNullAssertion: AppDefinitionSchema guarantees one entity
  return def.entities[0]!
}

export function fieldTypesOf(entity: EntityDef): Record<string, FieldType> {
  return Object.fromEntries(entity.fields.map((f) => [f.id, f.type]))
}

export function fieldLabel(entity: EntityDef, id: string): string {
  return entity.fields.find((f) => f.id === id)?.label ?? SYSTEM_FIELD_LABELS[id] ?? id
}

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** Calendar parts of an instant in an IANA time zone (ADR-0005: business dates never depend on host TZ). */
function zonedParts(d: Date, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00'
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Calendar date 'YYYY-MM-DD' of an instant in the business time zone. */
export function localDate(d: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  const p = zonedParts(d, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * ADR-0002 virtual default fill: fields missing from stored data read as `default ?? null`.
 * Keys unknown to the current definition are kept in storage but not exposed.
 */
export function materialize(rec: StoredRecord, entity: EntityDef): Row {
  const values: Record<string, FieldValue> = {}
  for (const f of entity.fields) {
    const v = rec.data[f.id]
    values[f.id] = v === undefined ? (f.default ?? null) : (v as FieldValue)
  }
  return { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt, values }
}

export interface RecordFieldError {
  field: string
  message: string
}
export type RecordInputResult =
  | { ok: true; values: Record<string, FieldValue> }
  | { ok: false; errors: RecordFieldError[] }

const MAX_LEN: Record<'string' | 'text', number> = { string: 200, text: 2000 }

/** Validates and coerces user input against the current entity schema (server is the source of truth). */
export function validateRecordInput(
  entity: EntityDef,
  input: unknown,
  mode: 'create' | 'update',
): RecordInputResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: '记录数据必须是对象' }] }
  }
  const errors: RecordFieldError[] = []
  const values: Record<string, FieldValue> = {}
  const byId = new Map(entity.fields.map((f) => [f.id, f]))

  for (const [key, raw] of Object.entries(input)) {
    if (isReservedFieldId(key)) {
      errors.push({ field: key, message: `「${SYSTEM_FIELD_LABELS[key]}」由系统维护，不能修改` })
      continue
    }
    const f = byId.get(key)
    if (!f) {
      errors.push({ field: key, message: `未知字段「${key}」` })
      continue
    }
    const r = coerceValue(raw, f)
    if (!r.ok) errors.push({ field: key, message: `${f.label}：${r.message}` })
    else if (r.value === null && f.required) errors.push({ field: key, message: `${f.label}为必填项` })
    else values[key] = r.value
  }

  if (mode === 'create') {
    for (const f of entity.fields) {
      if (key(values, f.id) || errors.some((e) => e.field === f.id)) continue
      if (f.default !== undefined) values[f.id] = f.default
      else if (f.required) errors.push({ field: f.id, message: `${f.label}为必填项` })
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, values }
}

function key(o: object, k: string) {
  return Object.hasOwn(o, k)
}

type Coerced = { ok: true; value: FieldValue } | { ok: false; message: string }

export function coerceValue(raw: unknown, f: FieldDef): Coerced {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw === 'string' && raw.trim() === '' && f.type !== 'boolean') return { ok: true, value: null }
  switch (f.type) {
    case 'string':
    case 'text': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, message: '应为文本' }
      const s = String(raw).trim()
      return s.length > MAX_LEN[f.type]
        ? { ok: false, message: `不能超过 ${MAX_LEN[f.type]} 个字符` }
        : { ok: true, value: s }
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: '应为数字' }
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true') return { ok: true, value: true }
      if (raw === 'false') return { ok: true, value: false }
      return { ok: false, message: '应为是或否' }
    case 'date':
      return isDateString(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: '应为有效日期（YYYY-MM-DD）' }
    case 'enum':
      return typeof raw === 'string' && f.options?.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `只能是 ${f.options?.join(' / ')} 之一` }
  }
}

// ── graph evaluation ─────────────────────────────────────────────────────────

export type NodeValue = Row[] | number | null

export interface NodeEval {
  inputs: Record<string, NodeValue>
  outputs: Record<string, NodeValue>
}

/** Evaluates the binding graph in topological order. Assumes a validated definition. */
export function evaluateGraph(def: AppDefinition, rows: Row[], ctx: EvalContext): Map<string, NodeEval> {
  const entity = primaryEntity(def)
  const types = fieldTypesOf(entity)
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const result = new Map<string, NodeEval>()

  for (const id of topoOrder(def)) {
    const node = byId.get(id)
    if (!node) continue
    const inputs: Record<string, NodeValue> = {}
    for (const b of def.bindings) {
      if (b.to.node === id) inputs[b.to.port] = result.get(b.from.node)?.outputs[b.from.port] ?? null
    }
    const outputs: Record<string, NodeValue> = {}
    switch (node.type) {
      case 'CollectionSource': {
        const p = node.params as ParamsOf<'CollectionSource'>
        outputs.records = p.sort ? sortRows(rows, p.sort.field, p.sort.dir, types) : [...rows]
        break
      }
      case 'Filter': {
        const p = node.params as ParamsOf<'Filter'>
        const input = asRows(inputs.input)
        outputs.result = input.filter((r) => evaluateFilter(p.filter, r, types, ctx))
        break
      }
      case 'Metric': {
        outputs.value = computeMetric(node.params as ParamsOf<'Metric'>, asRows(inputs.rows), types, ctx)
        break
      }
      default:
        break
    }
    result.set(id, { inputs, outputs })
  }
  return result
}

export function asRows(v: NodeValue | undefined): Row[] {
  return Array.isArray(v) ? v : []
}

export function sortRows(
  rows: Row[],
  field: string,
  dir: 'asc' | 'desc',
  types: Record<string, FieldType>,
): Row[] {
  const sign = dir === 'asc' ? 1 : -1
  const isNum = types[field] === 'number'
  return [...rows].sort((a, b) => {
    const x = getRowValue(a, field)
    const y = getRowValue(b, field)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    if (isNum) return (Number(x) - Number(y)) * sign
    return String(x).localeCompare(String(y), 'zh-CN') * sign
  })
}

export function computeMetric(
  p: ParamsOf<'Metric'>,
  rows: Row[],
  types: Record<string, FieldType>,
  ctx: EvalContext,
): number | null {
  if (p.aggregate === 'ratio') {
    if (!rows.length || !p.where) return null
    const where = p.where
    return rows.filter((r) => evaluateFilter(where, r, types, ctx)).length / rows.length
  }
  const where = p.where
  const scoped = where ? rows.filter((r) => evaluateFilter(where, r, types, ctx)) : rows
  if (p.aggregate === 'count') return scoped.length
  const nums = scoped
    .map((r) => (p.field ? getRowValue(r, p.field) : null))
    .filter((v): v is number => typeof v === 'number')
  switch (p.aggregate) {
    case 'sum':
      return nums.reduce((s, n) => s + n, 0)
    case 'avg':
      return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null
    case 'min':
      return nums.length ? Math.min(...nums) : null
    case 'max':
      return nums.length ? Math.max(...nums) : null
  }
}

export interface Group {
  key: string
  label: string
  count: number
}

export function groupCounts(rows: Row[], field: FieldDef, maxGroups = 8): Group[] {
  const counts = new Map<string, number>()
  let empty = 0
  for (const r of rows) {
    const v = r.values[field.id]
    if (v === null || v === undefined || v === '') empty++
    else counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
  }
  let groups: Group[]
  if (field.type === 'enum') {
    groups = (field.options ?? []).map((o) => ({ key: o, label: o, count: counts.get(o) ?? 0 }))
  } else if (field.type === 'boolean') {
    groups = [
      { key: 'true', label: '是', count: counts.get('true') ?? 0 },
      { key: 'false', label: '否', count: counts.get('false') ?? 0 },
    ]
  } else {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    groups = sorted.slice(0, maxGroups).map(([k, c]) => ({ key: k, label: k, count: c }))
    const rest = sorted.slice(maxGroups).reduce((s, [, c]) => s + c, 0)
    if (rest) groups.push({ key: '__other', label: '其他', count: rest })
  }
  if (empty) groups.push({ key: '__empty', label: '（空）', count: empty })
  return groups
}

export function formatTimestamp(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = zonedParts(d, timeZone)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

export function formatValue(
  v: FieldValue | undefined,
  fieldId: string,
  entity: EntityDef,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (v === null || v === undefined) return ''
  if (fieldId === 'createdAt' || fieldId === 'updatedAt') return formatTimestamp(String(v), timeZone)
  const f = entity.fields.find((x) => x.id === fieldId)
  if (f?.type === 'boolean' || typeof v === 'boolean') return v === true ? '是' : '否'
  return String(v)
}

export function renderTemplate(
  template: string,
  row: Row,
  entity: EntityDef,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, id: string) =>
    formatValue(getRowValue(row, id), id, entity, timeZone),
  )
}

/** Resolves QuickAction.set: date tokens → today, then values the user typed for `ask` fields. */
export function resolveSet(
  set: Record<string, FieldValue>,
  ask: Record<string, FieldValue>,
  ctx: EvalContext,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const [k, v] of Object.entries(set)) {
    out[k] = (DATE_TOKENS as readonly unknown[]).includes(v) ? ctx.today : v
  }
  return { ...out, ...ask }
}

const CSV_INJECTION = /^[=+\-@\t\r]/

function csvCell(s: string): string {
  // Neutralize spreadsheet formula injection, then quote when needed.
  const safe = CSV_INJECTION.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV with UTF-8 BOM so Excel opens Chinese text correctly (AC-11). */
export function toCSV(
  rows: Row[],
  columns: string[],
  entity: EntityDef,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const header = columns.map((c) => csvCell(fieldLabel(entity, c)))
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = getRowValue(r, c)
        return typeof v === 'number' ? String(v) : csvCell(formatValue(v, c, entity, timeZone))
      })
      .join(','),
  )
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`
}

export function defaultColumns(entity: EntityDef): string[] {
  return [...entity.fields.map((f) => f.id), 'createdAt']
}

export interface Layout {
  main: NodeDef[]
  aside: NodeDef[]
}

/**
 * Visible visual nodes of one page, ordered by `order` then declaration order (protocol §3.1).
 * Default: the admin page (nodes without `view`) grouped by region. With `view`: that role view,
 * a single column returned as `main`.
 */
export function layoutNodes(
  def: AppDefinition,
  opts: { includeHidden?: boolean; view?: string } = {},
): Layout {
  const visual = def.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => REGISTRY[n.type].visual && (opts.includeHidden || !n.hidden) && n.view === opts.view)
  const sort = (a: { n: NodeDef; i: number }, b: { n: NodeDef; i: number }) =>
    (a.n.order ?? 500 + a.i) - (b.n.order ?? 500 + b.i) || a.i - b.i
  if (opts.view !== undefined) return { main: visual.sort(sort).map(({ n }) => n), aside: [] }
  return {
    main: visual
      .filter(({ n }) => (n.region ?? 'main') === 'main')
      .sort(sort)
      .map(({ n }) => n),
    aside: visual
      .filter(({ n }) => n.region === 'aside')
      .sort(sort)
      .map(({ n }) => n),
  }
}
