import { describe, expect, it } from 'vitest'
import { suggestFollowUp } from './suggest'
import { CTX, equipmentDef, eventDef, patchOn, row, withCheckin } from './test-helpers'

const person = (name: string, major: string, checkedIn = false) => row({ name, major, checkedIn })

/** 张三 checked in; 李四 / 赵六 are CS and not checked in (the reminder reaches them); three others are not. */
const sixPeople = () => [
  person('张三', '计算机', true),
  person('李四', '计算机'),
  person('赵六', '计算机'),
  person('王五', '电子信息'),
  person('孙七', '其他'),
  person('周八', '数学'),
]

describe('suggestFollowUp (requirements §7 P1)', () => {
  it('a low check-in rate whose reminder reaches only CS majors suggests following up the others', () => {
    expect(suggestFollowUp(withCheckin(), sixPeople(), CTX)).toEqual({
      metricId: 'rate',
      metricLabel: '签到率',
      rate: 1 / 6,
      where: { field: 'checkedIn', operator: 'eq', value: true },
      total: 6,
      remaining: 5,
      unreached: 3,
      partlyReached: true,
    })
  })

  it('stays quiet at or above half, when a draft already reaches everyone left, or with too few records', () => {
    const half = sixPeople().map((r, i) => (i < 3 ? { ...r, values: { ...r.values, checkedIn: true } } : r))
    expect(suggestFollowUp(withCheckin(), half, CTX)).toBeNull()

    const allCs = [
      person('甲', '计算机', true),
      ...['乙', '丙', '丁', '戊', '己'].map((n) => person(n, '计算机')),
    ]
    expect(suggestFollowUp(withCheckin(), allCs, CTX)).toBeNull()

    expect(suggestFollowUp(withCheckin(), sixPeople().slice(1, 5), CTX)).toBeNull()
  })

  it('a hidden reminder reaches nobody', () => {
    const r = patchOn(withCheckin(), [{ op: 'hideNode', nodeId: 'remind' }])
    expect(r.ok).toBe(true)
    expect(suggestFollowUp(r.after!, sixPeople(), CTX)).toMatchObject({ unreached: 5, partlyReached: false })
  })

  it('works on any domain from component types alone, and not at all without a ratio metric', () => {
    const r = patchOn(equipmentDef(), [
      {
        op: 'addNode',
        node: {
          id: 'availableRate',
          type: 'Metric',
          title: '可借比例',
          params: {
            label: '可借比例',
            aggregate: 'ratio',
            where: { field: 'status', operator: 'eq', value: '可借用' },
            format: 'percent',
          },
        },
      },
      {
        op: 'bind',
        binding: {
          id: 'bAvail',
          from: { node: 'source', port: 'records' },
          to: { node: 'availableRate', port: 'rows' },
        },
      },
    ])
    expect(r.ok).toBe(true)
    const devices = ['可借用', '已借出', '已借出', '维修中', '已借出', '已借出'].map((status, i) =>
      row({ name: `设备${i}`, code: `D${i}`, category: '其他', status }),
    )
    expect(suggestFollowUp(r.after!, devices, CTX)).toMatchObject({
      metricId: 'availableRate',
      remaining: 5,
      unreached: 5,
      partlyReached: false,
    })
    expect(suggestFollowUp(equipmentDef(), devices, CTX)).toBeNull()
    expect(suggestFollowUp(eventDef(), sixPeople(), CTX)).toBeNull()
  })
})
