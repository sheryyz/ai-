import { describe, expect, it } from 'vitest'
import { explainNode } from './explain'
import type { StoredRecord } from './runtime'
import { CTX, withCheckin } from './test-helpers'

const records: StoredRecord[] = [
  { id: 'a', data: { name: '甲', major: '计算机' }, createdAt: '2026-11-11', updatedAt: '2026-11-11' },
  {
    id: 'b',
    data: { name: '乙', major: '计算机', checkedIn: true },
    createdAt: '2026-11-11',
    updatedAt: '2026-11-11',
  },
  { id: 'c', data: { name: '丙', major: '其他' }, createdAt: '2026-11-11', updatedAt: '2026-11-11' },
]
describe('execution-grounded explanations', () => {
  it('explains the actual numerator, denominator and virtual defaults without writing records', () => {
    const original = JSON.stringify(records)
    const r = explainNode(withCheckin(), records, 'rate', CTX)!
    expect(r).toMatchObject({ total: 3, inputCount: 3, matched: 1, result: 1 / 3, aggregate: 'ratio' })
    expect(r.records.map((p) => p.included)).toEqual([false, true, false])
    expect(JSON.stringify(records)).toBe(original)
    expect(explainNode(withCheckin(), [], 'rate', CTX)).toMatchObject({ result: null, inputCount: 0 })
  })
  it('explains why a record enters or leaves a reminder and respects action availability', () => {
    const r = explainNode(withCheckin(), records, 'remind', CTX)!
    expect(r.steps).toMatchObject([{ nodeId: 'csAbsent', before: 3, after: 1 }])
    expect(r.records.map((p) => p.included)).toEqual([true, false, false])
    expect(r.records[1]?.checks[0]?.passed).toBe(false)
    expect(explainNode(withCheckin(), records, 'checkin', CTX)?.matched).toBe(2)
    expect(explainNode(withCheckin(), records, 'missing', CTX)).toBeNull()
  })
})
