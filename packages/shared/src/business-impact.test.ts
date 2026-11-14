import { describe, expect, it } from 'vitest'
import { computeBusinessImpact } from './business-impact'
import type { StoredRecord } from './runtime'
import { CTX, eventDef, patchOn, withCheckin } from './test-helpers'

const data: StoredRecord[] = [
  { id: 'a', data: { name: '甲', major: '计算机' }, createdAt: '2026-11-10', updatedAt: '2026-11-10' },
  {
    id: 'b',
    data: { name: '乙', major: '电子信息', checkedIn: true },
    createdAt: '2026-11-10',
    updatedAt: '2026-11-10',
  },
]

describe('business impact on a fixed record snapshot', () => {
  it('runs old and new definitions with virtual defaults without writing records', () => {
    const snapshot = JSON.stringify(data)
    const r = computeBusinessImpact(eventDef(), withCheckin(), data, CTX)
    expect(r.recordCount).toBe(2)
    expect(r.changes.find((c) => c.nodeId === 'rate')?.after).toMatchObject({
      value: 0.5,
      matched: 1,
      count: 2,
    })
    expect(r.changes.find((c) => c.nodeId === 'remind')?.entered).toEqual([{ id: 'a', label: '甲' }])
    expect(r.changes.find((c) => c.nodeId === 'checkin')?.after?.count).toBe(1)
    expect(JSON.stringify(data)).toBe(snapshot)
  })
  it('reports identity swaps even if counts are equal, and scope changes with zero records', () => {
    const before = withCheckin()
    const after = patchOn(before, [
      { op: 'setFilter', nodeId: 'csAbsent', filter: { field: 'major', operator: 'eq', value: '电子信息' } },
    ]).after!
    const change = computeBusinessImpact(before, after, data, CTX).changes.find((c) => c.nodeId === 'remind')!
    expect(change.before?.count).toBe(1)
    expect(change.after?.count).toBe(1)
    expect(change.entered.map((r) => r.id)).toEqual(['b'])
    expect(change.exited.map((r) => r.id)).toEqual(['a'])
    expect(
      computeBusinessImpact(before, after, [], CTX).changes.find((c) => c.nodeId === 'remind')?.scopeChanged,
    ).toBe(true)
    expect(computeBusinessImpact(before, before, data, CTX).changes).toEqual([])
  })
  it('counts hidden recipients as leaving and handles empty metric denominators', () => {
    const before = withCheckin()
    const hidden = patchOn(before, [{ op: 'hideNode', nodeId: 'remind' }]).after!
    expect(
      computeBusinessImpact(before, hidden, data, CTX).changes.find((c) => c.nodeId === 'remind'),
    ).toMatchObject({ after: null, exited: [{ id: 'a', label: '甲' }] })
    const empty = computeBusinessImpact(null, before, [], CTX)
    expect(empty.changes.find((c) => c.nodeId === 'rate')?.after).toMatchObject({ count: 0, value: null })
  })
})
