import { describe, expect, it } from 'vitest'
import { type BusinessRule, constraintIssues, scopeImplies } from './constraints'
import type { FilterExpr } from './filter'
import { recordScope } from './runtime'
import { eventDef, patchOn, signupPageOps, withCheckin, withDesk } from './test-helpers'

const rule = (r: BusinessRule) => [{ id: 'test', label: '已确认规则', rule: r }]
const unchecked: FilterExpr = { field: 'checkedIn', operator: 'eq', value: false }
const cs: FilterExpr = { field: 'major', operator: 'eq', value: '计算机' }

describe('persistent business constraints', () => {
  it('submit-only pages cannot later gain a list, aggregate, or action', () => {
    const def = patchOn(eventDef(), signupPageOps()).after!
    const viewId = def.views![0]!.id
    const rules = rule({ kind: 'submitOnly', viewId })
    expect(constraintIssues(def, rules)).toEqual([])
    for (const type of ['Table', 'Metric', 'QuickAction'] as const) {
      const next = structuredClone(def)
      next.nodes.push({
        id: 'bad',
        type,
        view: viewId,
        params:
          type === 'Table'
            ? { columns: ['name'] }
            : type === 'Metric'
              ? { aggregate: 'count' }
              : { searchFields: ['name'], set: { name: '修改' } },
      })
      expect(constraintIssues(next, rules)[0]?.code).toBe('BUSINESS_CONSTRAINT')
    }
  })

  it('write limits inspect action set/ask and reject new forms or removed protected views', () => {
    const def = withDesk()
    const rules = rule({ kind: 'allowedWrites', viewId: 'desk', fields: ['checkedIn'] })
    expect(constraintIssues(def, rules)).toEqual([])
    for (const params of [{ set: { checkedIn: true, name: '改名' } }, { ask: ['name'] }]) {
      const after = patchOn(def, [{ op: 'updateNode', nodeId: 'deskAction', params }]).after!
      expect(constraintIssues(after, rules)).toHaveLength(1)
    }
    const removed = patchOn(def, [{ op: 'removeView', viewId: 'desk' }]).after!
    expect(constraintIssues(removed, rules)).toHaveLength(1)
    const form = structuredClone(def)
    form.nodes.push({ id: 'newForm', type: 'Form', view: 'desk', params: { fields: ['checkedIn'] } })
    expect(constraintIssues(form, rules)).toHaveLength(1)
  })

  it('proves scope structurally, including all OR branches; equal current counts cannot bypass a rule', () => {
    const def = withCheckin()
    const rules = rule({ kind: 'messageScope', nodeId: 'remind', condition: unchecked })
    expect(recordScope(def, 'remind')).toEqual([{ op: 'and', conditions: [cs, unchecked] }])
    expect(constraintIssues(def, rules)).toEqual([])
    const broader = patchOn(def, [
      { op: 'setFilter', nodeId: 'csAbsent', filter: { op: 'or', conditions: [cs, unchecked] } },
    ]).after!
    expect(constraintIssues(broader, rules)).toHaveLength(1)
    expect(
      scopeImplies(
        { op: 'or', conditions: [{ op: 'and', conditions: [cs, unchecked] }, unchecked] },
        unchecked,
      ),
    ).toBe(true)
    expect(scopeImplies(unchecked, { op: 'and', conditions: [cs, unchecked] })).toBe(false)
    const hidden = patchOn(def, [{ op: 'hideNode', nodeId: 'remind' }]).after!
    expect(constraintIssues(hidden, rules)).toHaveLength(1)
    const bypass = patchOn(def, [
      { op: 'unbind', bindingId: 'b_remind' },
      {
        op: 'bind',
        binding: {
          id: 'bypass',
          from: { node: 'source', port: 'records' },
          to: { node: 'remind', port: 'recipients' },
        },
      },
    ]).after!
    expect(constraintIssues(bypass, rules)).toHaveLength(1)
  })
})
