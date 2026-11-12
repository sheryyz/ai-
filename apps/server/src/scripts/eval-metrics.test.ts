import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AppDefinition, StoredRecord } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../config'
import { destructiveChanges, percentile, recordPreserved, unrelatedChanges } from './eval-metrics'

const template = (): AppDefinition =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/templates/event-registration.json'), 'utf8'))
const rec = (data: Record<string, unknown>): StoredRecord => ({
  id: 'rec_1',
  data,
  createdAt: '2026-11-11T00:00:00Z',
  updatedAt: '2026-11-11T00:00:00Z',
})
const zhang = rec({ name: '张三', studentId: '2024001', major: '计算机', phone: '13800000001' })

describe('recordPreserved', () => {
  it('keeps a record whose values all remain readable, including under added fields', () => {
    const after = template()
    after.entities[0]?.fields.push({ id: 'checkedIn', label: '已签到', type: 'boolean', required: false })
    expect(recordPreserved(zhang, template(), after)).toBe(true)
  })

  it('loses a record when a used field is removed, retyped, or its option disappears', () => {
    const removed = template()
    removed.entities[0]?.fields.splice(3, 1)
    expect(recordPreserved(zhang, template(), removed)).toBe(false)
    expect(recordPreserved(rec({ name: '李四', studentId: '1', major: '数学' }), template(), removed)).toBe(
      true,
    )

    const retyped = template()
    const sid = retyped.entities[0]?.fields[1]
    if (sid) sid.type = 'number'
    expect(recordPreserved(zhang, template(), retyped)).toBe(false)

    const option = template()
    const major = option.entities[0]?.fields[2]
    if (major) major.options = ['计算机科学与技术', '其他']
    expect(recordPreserved(zhang, template(), option)).toBe(false)
    expect(destructiveChanges(template(), option)).toEqual([
      '字段「专业」的选项被删除：计算机、软件工程、人工智能、电子信息、数学',
    ])
  })

  it('loses every record when the entity id changes', () => {
    const renamed = template()
    if (renamed.entities[0]) renamed.entities[0].id = 'signup2'
    expect(recordPreserved(zhang, template(), renamed)).toBe(false)
  })
})

describe('unrelatedChanges', () => {
  it('ignores allowed nodes, additions, layout moves, description and renamed binding ids', () => {
    const after = template()
    const roster = after.nodes.find((n) => n.id === 'roster')
    if (roster) roster.params = { ...roster.params, pageSize: 50 }
    const chart = after.nodes.find((n) => n.id === 'byMajor')
    if (chart) chart.order = 9
    after.description = '新的说明'
    after.bindings = after.bindings.map((b, i) => ({ ...b, id: `renamed${i}` }))
    after.nodes.push({ id: 'note', type: 'Metric', region: 'main', order: 8, params: { aggregate: 'count' } })
    expect(unrelatedChanges(template(), after, ['roster'])).toEqual([])
  })

  it('counts replaced components, rewiring, field edits and a renamed app', () => {
    const after = template()
    const roster = after.nodes.find((n) => n.id === 'roster')
    if (roster) roster.id = 'signupTable'
    for (const b of after.bindings) if (b.to.node === 'roster') b.to.node = 'signupTable'
    const major = after.entities[0]?.fields[2]
    if (major) major.label = '所在专业'
    after.name = '讲座报名'
    expect(unrelatedChanges(template(), after, [])).toEqual([
      '移除组件 roster',
      '修改字段 major（label）',
      '修改应用名称',
    ])
  })
})

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([], 50)).toBeNaN()
  })
})
