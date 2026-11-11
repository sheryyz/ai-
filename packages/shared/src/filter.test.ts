import { describe, expect, it } from 'vitest'
import { addDays, checkFilterShape, evaluateFilter, type FieldType, type FilterExpr } from './filter'
import { CTX, row } from './test-helpers'

const types: Record<string, FieldType> = {
  name: 'string',
  major: 'enum',
  checkedIn: 'boolean',
  score: 'number',
  borrowedAt: 'date',
}

describe('filter DSL shape (protocol §5)', () => {
  it('accepts a nested and/or expression', () => {
    expect(
      checkFilterShape({
        op: 'and',
        conditions: [
          { field: 'major', operator: 'in', value: ['计算机', '数学'] },
          { op: 'or', conditions: [{ field: 'checkedIn', operator: 'eq', value: false }] },
        ],
      }),
    ).toEqual([])
  })

  it('reports precise paths for malformed conditions', () => {
    const issues = checkFilterShape({
      op: 'and',
      conditions: [
        { field: 'major', operator: 'like', value: 'x' },
        { field: 'name', operator: 'in', value: 'a' },
      ],
    })
    expect(issues.map((i) => i.path.join('.'))).toEqual(['conditions.0.operator', 'conditions.1.value'])
  })

  it('rejects nesting deeper than 3 levels', () => {
    const deep = {
      op: 'and',
      conditions: [{ op: 'and', conditions: [{ op: 'and', conditions: [{ op: 'and', conditions: [] }] }] }],
    }
    expect(checkFilterShape(deep).some((i) => i.message.includes('3 层'))).toBe(true)
  })

  it('requires a value except for isEmpty / notEmpty', () => {
    expect(checkFilterShape({ field: 'phone', operator: 'isEmpty' })).toEqual([])
    expect(checkFilterShape({ field: 'phone', operator: 'eq' })).toHaveLength(1)
  })
})

describe('evaluateFilter', () => {
  const alice = row({ name: 'Alice', major: '计算机', checkedIn: false, score: 90, borrowedAt: '2026-11-01' })
  const bob = row({ name: 'Bob', major: '数学', checkedIn: true, score: 70, borrowedAt: null })
  const ev = (e: FilterExpr) =>
    [alice, bob].filter((r) => evaluateFilter(e, r, types, CTX)).map((r) => r.values.name)

  it('combines conditions with and', () => {
    expect(
      ev({
        op: 'and',
        conditions: [
          { field: 'major', operator: 'eq', value: '计算机' },
          { field: 'checkedIn', operator: 'eq', value: false },
        ],
      }),
    ).toEqual(['Alice'])
  })

  it('supports or, in, notIn', () => {
    expect(
      ev({
        op: 'or',
        conditions: [
          { field: 'score', operator: 'gt', value: 80 },
          { field: 'checkedIn', operator: 'eq', value: true },
        ],
      }),
    ).toEqual(['Alice', 'Bob'])
    expect(ev({ field: 'major', operator: 'in', value: ['数学', '物理'] })).toEqual(['Bob'])
    expect(ev({ field: 'major', operator: 'notIn', value: ['数学'] })).toEqual(['Alice'])
  })

  it('compares numbers numerically and text case-insensitively', () => {
    expect(ev({ field: 'score', operator: 'lte', value: 70 })).toEqual(['Bob'])
    expect(ev({ field: 'name', operator: 'contains', value: 'ali' })).toEqual(['Alice'])
    expect(ev({ field: 'name', operator: 'startsWith', value: 'B' })).toEqual(['Bob'])
  })

  it('resolves relative dates against the context day (borrowed > 7 days)', () => {
    expect(addDays('2026-11-11', -7)).toBe('2026-11-04')
    expect(ev({ field: 'borrowedAt', operator: 'lt', value: { relative: 'daysAgo', days: 7 } })).toEqual([
      'Alice',
    ])
  })

  it('treats null as empty and never matches ordered comparisons', () => {
    expect(ev({ field: 'borrowedAt', operator: 'isEmpty' })).toEqual(['Bob'])
    expect(ev({ field: 'borrowedAt', operator: 'gte', value: '2000-01-01' })).toEqual(['Alice'])
  })

  it('filters reserved timestamps by calendar day', () => {
    const late = row({ name: 'Carol' }, '2026-11-11T10:00:00.000Z')
    expect(
      evaluateFilter({ field: 'createdAt', operator: 'eq', value: { relative: 'today' } }, late, types, CTX),
    ).toBe(true)
  })
})
