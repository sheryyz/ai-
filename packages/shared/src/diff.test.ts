import { describe, expect, it } from 'vitest'
import { computeDiff, stableStringify } from './diff'
import { applyPatch } from './patch'
import { validateProposal } from './proposal'
import { checkinProposal, eventDef } from './test-helpers'

describe('computeDiff', () => {
  const before = eventDef()
  const after = validateProposal(checkinProposal(), { current: { definition: before, version: 1 } }).after!

  it('describes the check-in evolution from the two full definitions', () => {
    const d = computeDiff(before, after, { fromVersion: 1, recordCount: 37 })
    expect(d.fields.added.map((f) => f.id)).toEqual(['checkedIn'])
    expect(d.nodes.added.map((n) => n.id)).toEqual(['checkin', 'csAbsent', 'remind', 'rate'])
    expect(d.bindings.added).toHaveLength(4)
    expect(d.nodes.hidden).toEqual(['byMajor'])
    expect(d.nodes.moved.map((m) => m.nodeId)).toEqual(['total'])
    expect(d.preserved).toEqual({ recordCount: 37, fieldIds: ['name', 'studentId', 'major', 'phone'] })
    expect(d.summary).toBe('新增 1 个字段，新增 4 个组件，新增 4 条数据连接，移动 1 个组件，隐藏 1 个组件')
  })

  it('explains virtual default fill for existing records', () => {
    const d = computeDiff(before, after, { fromVersion: 1, recordCount: 37 })
    expect(d.impacts[0]).toMatchObject({ kind: 'defaultFill', affectedRecords: 37 })
    expect(d.impacts[0]?.message).toContain('「否」')
    expect(d.impacts[0]?.message).toContain('不改写数据库')
  })

  it('rates hide-only changes medium and removing the only form high', () => {
    expect(computeDiff(before, after, { fromVersion: 1, recordCount: 0 }).risk).toBe('medium')
    const r = applyPatch(before, [{ op: 'removeNode', nodeId: 'signup' }])
    if (!r.ok) throw new Error('unexpected')
    const d = computeDiff(before, r.definition, { fromVersion: 1, recordCount: 5 })
    expect(d.risk).toBe('high')
    expect(d.impacts.map((i) => i.kind)).toEqual(['nodeRemoved', 'writeCapabilityRemoved'])
  })

  it('reports param changes by key', () => {
    const r = applyPatch(before, [
      { op: 'updateNode', nodeId: 'roster', params: { pageSize: 20 }, title: '全部报名' },
    ])
    if (!r.ok) throw new Error('unexpected')
    expect(computeDiff(before, r.definition, { fromVersion: 1, recordCount: 0 }).nodes.changed).toEqual([
      { nodeId: 'roster', type: 'Table', title: '全部报名', keys: ['title', 'pageSize'] },
    ])
  })

  it('summarizes creation when there is no previous version', () => {
    const d = computeDiff(null, before, { fromVersion: 0, recordCount: 0 })
    expect(d.summary).toBe('创建「校园讲座报名」：4 个字段、5 个组件、4 条数据连接')
    expect(d.risk).toBe('low')
  })

  it('detects an empty change set', () => {
    expect(computeDiff(before, eventDef(), { fromVersion: 1, recordCount: 0 }).isEmpty).toBe(true)
  })

  it('stableStringify ignores key order', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(
      stableStringify({ a: [{ x: 1, y: 2 }], b: 1 }),
    )
  })
})
