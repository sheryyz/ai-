/**
 * protocol.md §5 — filter DSL: shape check, type check and evaluation.
 * Evaluation is a pure function; no eval, no SQL. Server (CSV export) and web (rendering) share it.
 */
import { isReservedFieldId, isSlug } from './ids'
import { z } from './zod'

export type FieldType = 'string' | 'text' | 'number' | 'date' | 'boolean' | 'enum'
export type FieldValue = string | number | boolean | null
export type RelativeDate =
  | { relative: 'today' }
  | { relative: 'daysAgo'; days: number }
  | { relative: 'daysFromNow'; days: number }

export type Operator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'in'
  | 'notIn'
  | 'isEmpty'
  | 'notEmpty'

export interface Condition {
  field: string
  operator: Operator
  value?: FieldValue | FieldValue[] | RelativeDate
}
export interface FilterGroup {
  op: 'and' | 'or'
  conditions: FilterExpr[]
}
// Recursive types cannot be inferred from Zod; this is the single hand-written domain type (see CLAUDE.md).
export type FilterExpr = FilterGroup | Condition

export const OPERATORS: readonly Operator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'startsWith',
  'in',
  'notIn',
  'isEmpty',
  'notEmpty',
]

/** protocol.md §5 table: operators allowed per field type. */
export const OPERATORS_BY_TYPE: Record<FieldType, readonly Operator[]> = {
  string: ['eq', 'ne', 'contains', 'notContains', 'startsWith', 'in', 'notIn', 'isEmpty', 'notEmpty'],
  text: ['eq', 'ne', 'contains', 'notContains', 'startsWith', 'in', 'notIn', 'isEmpty', 'notEmpty'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'],
  boolean: ['eq', 'ne'],
  enum: ['eq', 'ne', 'in', 'notIn', 'isEmpty', 'notEmpty'],
}

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  contains: '包含',
  notContains: '不包含',
  startsWith: '开头是',
  in: '属于',
  notIn: '不属于',
  isEmpty: '为空',
  notEmpty: '不为空',
}

const NO_VALUE_OPERATORS: readonly Operator[] = ['isEmpty', 'notEmpty']
const LIST_OPERATORS: readonly Operator[] = ['in', 'notIn']

export const MAX_FILTER_DEPTH = 3
export const MAX_FILTER_ITEMS = 10

export function isFilterGroup(expr: FilterExpr): expr is FilterGroup {
  return 'conditions' in expr
}

export function isRelativeDate(v: unknown): v is RelativeDate {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'relative' in v
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export interface ShapeIssue {
  path: (string | number)[]
  message: string
}

/** Structural check (protocol §5) with precise paths. Type compatibility is checked later against the entity. */
export function checkFilterShape(raw: unknown, path: (string | number)[] = [], depth = 1): ShapeIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ path, message: '筛选条件必须是对象：条件 {field, operator, value} 或组合 {op, conditions}' }]
  }
  const o = raw as Record<string, unknown>
  if ('conditions' in o || 'op' in o) {
    const issues: ShapeIssue[] = []
    if (o.op !== 'and' && o.op !== 'or')
      issues.push({ path: [...path, 'op'], message: 'op 只能是 "and" 或 "or"' })
    if (depth > MAX_FILTER_DEPTH) {
      issues.push({ path, message: `筛选嵌套不能超过 ${MAX_FILTER_DEPTH} 层` })
      return issues
    }
    if (!Array.isArray(o.conditions) || o.conditions.length === 0) {
      issues.push({ path: [...path, 'conditions'], message: 'conditions 必须是非空数组' })
      return issues
    }
    if (o.conditions.length > MAX_FILTER_ITEMS) {
      issues.push({ path: [...path, 'conditions'], message: `每组最多 ${MAX_FILTER_ITEMS} 个条件` })
    }
    o.conditions.forEach((c, i) => {
      issues.push(...checkFilterShape(c, [...path, 'conditions', i], depth + 1))
    })
    return issues
  }
  const issues: ShapeIssue[] = []
  if (typeof o.field !== 'string' || !(isSlug(o.field) || isReservedFieldId(o.field))) {
    issues.push({ path: [...path, 'field'], message: 'field 必须是字段标识符' })
  }
  if (typeof o.operator !== 'string' || !OPERATORS.includes(o.operator as Operator)) {
    issues.push({ path: [...path, 'operator'], message: `operator 必须是 ${OPERATORS.join(' / ')} 之一` })
    return issues
  }
  const op = o.operator as Operator
  if (NO_VALUE_OPERATORS.includes(op)) return issues
  if (!('value' in o)) {
    issues.push({ path: [...path, 'value'], message: `操作符 ${op} 需要 value` })
    return issues
  }
  const v = o.value
  if (LIST_OPERATORS.includes(op)) {
    if (!Array.isArray(v) || v.length === 0 || !v.every(isScalar)) {
      issues.push({ path: [...path, 'value'], message: `操作符 ${op} 的 value 必须是非空数组` })
    }
  } else if (isRelativeDate(v)) {
    issues.push(...checkRelativeDateShape(v, [...path, 'value']))
  } else if (!isScalar(v)) {
    issues.push({ path: [...path, 'value'], message: 'value 必须是字符串、数字、布尔值或相对日期' })
  }
  return issues
}

function isScalar(v: unknown): v is FieldValue {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}

function checkRelativeDateShape(v: Record<string, unknown>, path: (string | number)[]): ShapeIssue[] {
  if (v.relative === 'today') return []
  if (v.relative === 'daysAgo' || v.relative === 'daysFromNow') {
    return Number.isInteger(v.days) && (v.days as number) >= 0 && (v.days as number) <= 3650
      ? []
      : [{ path: [...path, 'days'], message: 'days 必须是 0–3650 的整数' }]
  }
  return [{ path: [...path, 'relative'], message: 'relative 只能是 today / daysAgo / daysFromNow' }]
}

/** Zod schema wrapper so params schemas can embed a filter with precise issue paths. */
export const FilterExprSchema = z.unknown().superRefine((v, ctx) => {
  for (const issue of checkFilterShape(v)) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
  }
}) as unknown as z.ZodType<FilterExpr>

/** Walks every condition in an expression, with its path relative to the expression root. */
export function forEachCondition(
  expr: FilterExpr,
  fn: (c: Condition, path: (string | number)[]) => void,
  path: (string | number)[] = [],
): void {
  if (isFilterGroup(expr)) {
    expr.conditions.forEach((c, i) => {
      forEachCondition(c, fn, [...path, 'conditions', i])
    })
  } else {
    fn(expr, path)
  }
}

// ── evaluation ──────────────────────────────────────────────────────────────

export interface EvalContext {
  /** Local date 'YYYY-MM-DD' used for relative dates and the $today token. */
  today: string
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function resolveRelativeDate(v: RelativeDate, ctx: EvalContext): string {
  switch (v.relative) {
    case 'today':
      return ctx.today
    case 'daysAgo':
      return addDays(ctx.today, -v.days)
    case 'daysFromNow':
      return addDays(ctx.today, v.days)
  }
}

function isEmptyValue(v: FieldValue | undefined): boolean {
  return v === null || v === undefined || v === ''
}

function normalizeForCompare(v: FieldValue | undefined, fieldType: FieldType | 'timestamp'): FieldValue {
  if (v === undefined) return null
  // Timestamps (createdAt/updatedAt) compare as dates when the condition value is a date.
  if (fieldType === 'timestamp' && typeof v === 'string') return v.slice(0, 10)
  return v
}

export interface Row {
  id: string
  createdAt: string
  updatedAt: string
  values: Record<string, FieldValue>
}

export function getRowValue(row: Row, field: string): FieldValue {
  if (field === 'id') return row.id
  if (field === 'createdAt') return row.createdAt
  if (field === 'updatedAt') return row.updatedAt
  return row.values[field] ?? null
}

/**
 * Evaluates a filter against a materialized row. `fieldTypes` maps field id → type
 * (reserved timestamps are handled automatically). Unknown fields evaluate to null.
 */
export function evaluateFilter(
  expr: FilterExpr,
  row: Row,
  fieldTypes: Record<string, FieldType>,
  ctx: EvalContext,
): boolean {
  if (isFilterGroup(expr)) {
    return expr.op === 'and'
      ? expr.conditions.every((c) => evaluateFilter(c, row, fieldTypes, ctx))
      : expr.conditions.some((c) => evaluateFilter(c, row, fieldTypes, ctx))
  }
  const type: FieldType | 'timestamp' =
    expr.field === 'createdAt' || expr.field === 'updatedAt'
      ? 'timestamp'
      : (fieldTypes[expr.field] ?? 'string')
  const actual = normalizeForCompare(getRowValue(row, expr.field), type)
  const raw = expr.value
  const target: FieldValue | FieldValue[] | undefined = isRelativeDate(raw)
    ? resolveRelativeDate(raw, ctx)
    : raw

  switch (expr.operator) {
    case 'isEmpty':
      return isEmptyValue(actual)
    case 'notEmpty':
      return !isEmptyValue(actual)
    case 'eq':
      return looseEquals(actual, target)
    case 'ne':
      return !looseEquals(actual, target)
    case 'in':
      return Array.isArray(target) && target.some((t) => looseEquals(actual, t))
    case 'notIn':
      return Array.isArray(target) && !target.some((t) => looseEquals(actual, t))
    case 'contains':
      return typeof actual === 'string' && typeof target === 'string'
        ? actual.toLowerCase().includes(target.toLowerCase())
        : false
    case 'notContains':
      return typeof target === 'string'
        ? !(typeof actual === 'string' && actual.toLowerCase().includes(target.toLowerCase()))
        : true
    case 'startsWith':
      return typeof actual === 'string' && typeof target === 'string'
        ? actual.toLowerCase().startsWith(target.toLowerCase())
        : false
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareOrdered(actual, target, expr.operator)
  }
}

function looseEquals(a: FieldValue, b: FieldValue | FieldValue[] | undefined): boolean {
  if (Array.isArray(b) || b === undefined) return false
  if (a === null || b === null) return a === b
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b)
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b
  return a === b
}

function compareOrdered(
  a: FieldValue,
  b: FieldValue | FieldValue[] | undefined,
  op: 'gt' | 'gte' | 'lt' | 'lte',
): boolean {
  if (a === null || b === null || b === undefined || Array.isArray(b)) return false
  if (typeof a === 'boolean' || typeof b === 'boolean') return false
  let x: number | string = a
  let y: number | string = b
  if (typeof a === 'number' || typeof b === 'number') {
    x = Number(a)
    y = Number(b)
    if (Number.isNaN(x) || Number.isNaN(y)) return false
  }
  switch (op) {
    case 'gt':
      return x > y
    case 'gte':
      return x >= y
    case 'lt':
      return x < y
    case 'lte':
      return x <= y
  }
}
