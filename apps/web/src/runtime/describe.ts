/** Human-readable rendering of filter expressions and values for chips and Diff cards. */
import {
  type EntityDef,
  type FieldValue,
  type FilterExpr,
  fieldLabel,
  isFilterGroup,
  isRelativeDate,
  OPERATOR_LABELS,
} from '@morphos/shared'

export function describeValue(v: unknown): string {
  if (v === null || v === undefined) return '空'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return v.map(describeValue).join('、')
  if (isRelativeDate(v)) {
    if (v.relative === 'today') return '今天'
    return v.relative === 'daysAgo' ? `${v.days} 天前` : `${v.days} 天后`
  }
  if (v === '$today') return '今天'
  if (v === '$now') return '现在'
  return String(v as FieldValue)
}

export interface Chip {
  key: string
  text: string
}

/** Flattens an expression into chips; nested groups are shown inline with their connective. */
export function filterChips(expr: FilterExpr, entity: EntityDef, path = 'f'): Chip[] {
  if (!isFilterGroup(expr)) {
    const needsValue = expr.operator !== 'isEmpty' && expr.operator !== 'notEmpty'
    return [
      {
        key: path,
        text: `${fieldLabel(entity, expr.field)} ${OPERATOR_LABELS[expr.operator]}${needsValue ? ` ${describeValue(expr.value)}` : ''}`,
      },
    ]
  }
  if (expr.op === 'and') return expr.conditions.flatMap((c, i) => filterChips(c, entity, `${path}.${i}`))
  return [
    {
      key: path,
      text: expr.conditions.map((c, i) => describeFilter(c, entity, `${path}.${i}`)).join(' 或 '),
    },
  ]
}

export function describeFilter(expr: FilterExpr, entity: EntityDef, path = 'f'): string {
  const chips = filterChips(expr, entity, path).map((c) => c.text)
  return chips.length > 1 ? `（${chips.join(' 且 ')}）` : (chips[0] ?? '')
}
