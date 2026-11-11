import { describe, expect, it } from 'vitest'
import { applyPatch } from './patch'
import { validateProposal } from './proposal'
import type { PatchOp } from './schema'
import { checkinProposal, eventDef, rawEvent } from './test-helpers'

const current = () => ({ definition: eventDef(), version: 1 })
const patch = (operations: unknown[], baseVersion = 1) => ({
  kind: 'patch',
  intent: '测试',
  summary: '测试',
  baseVersion,
  operations,
})

describe('create proposals', () => {
  it('accepts a valid definition and returns it normalized', () => {
    const r = validateProposal({
      kind: 'create',
      intent: '讲座报名',
      summary: '报名应用',
      definition: rawEvent(),
    })
    expect(r.ok).toBe(true)
    expect(r.after?.name).toBe('校园讲座报名')
  })

  it('prefixes definition issues with "definition."', () => {
    const d = rawEvent()
    d.nodes[3]!.params.columns = ['nope']
    const r = validateProposal({ kind: 'create', intent: 'x', summary: 'x', definition: d })
    expect(r.issues[0]?.path).toBe('definition.nodes[3].params.columns[0]')
  })
})

describe('patch proposals', () => {
  it('AC-03: the check-in evolution patch passes all six layers', () => {
    const r = validateProposal(checkinProposal(), { current: current() })
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.after?.entities[0]?.fields.map((f) => f.id)).toContain('checkedIn')
    expect(r.after?.nodes.find((n) => n.id === 'byMajor')?.hidden).toBe(true)
  })

  it.each([
    [
      'deleteRecords',
      {
        op: 'deleteRecords',
        entityId: 'attendee',
        where: { field: 'checkedIn', operator: 'eq', value: false },
      },
    ],
    ['dropCollection', { op: 'dropCollection', entityId: 'attendee' }],
    ['rawSQL', { op: 'rawSQL', sql: 'DELETE FROM records' }],
    ['removeField', { op: 'removeField', entityId: 'attendee', fieldId: 'phone' }],
  ])('AC-07: rejects forbidden op %s at the safety layer with a rewrite hint', (_name, op) => {
    const r = validateProposal(patch([op]), { current: current() })
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({
      layer: 'safety',
      code: 'SAFETY_FORBIDDEN_OP',
      path: 'operations[0].op',
    })
    expect(r.issues[0]?.hint).toBeTruthy()
    expect(r.after).toBeUndefined()
  })

  it('suggests hiding instead of deleting records', () => {
    const r = validateProposal(patch([{ op: 'deleteRecords', entityId: 'attendee' }]), { current: current() })
    expect(r.issues[0]?.hint).toMatch(/Filter|hideNode/)
  })

  it('rejects unknown ops by whitelist, not by keyword', () => {
    const r = validateProposal(patch([{ op: 'purgeEverything' }]), { current: current() })
    expect(r.issues[0]).toMatchObject({ layer: 'schema', code: 'SCHEMA_UNKNOWN_OP' })
  })

  it('AC-08: rejects a stale baseVersion', () => {
    const r = validateProposal(checkinProposal(), { current: { definition: eventDef(), version: 3 } })
    expect(r.ok).toBe(false)
    expect(r.issues).toContainEqual(expect.objectContaining({ layer: 'version', code: 'VERSION_CONFLICT' }))
  })

  it('AC-14: rejects changing a field type or removing enum options', () => {
    const r = validateProposal(
      patch([
        { op: 'updateField', entityId: 'attendee', fieldId: 'phone', changes: { type: 'number' } },
        { op: 'updateField', entityId: 'attendee', fieldId: 'major', changes: { removeOptions: ['数学'] } },
      ]),
      { current: current() },
    )
    expect(r.issues.map((i) => i.code)).toEqual(['SAFETY_DESTRUCTIVE_SCHEMA', 'SAFETY_DESTRUCTIVE_SCHEMA'])
    expect(r.issues.map((i) => i.path)).toEqual([
      'operations[0].changes.type',
      'operations[1].changes.removeOptions',
    ])
  })

  it('allows adding enum options but never removing them', () => {
    const r = validateProposal(
      patch([
        {
          op: 'updateField',
          entityId: 'attendee',
          fieldId: 'major',
          changes: { addOptions: ['物理', '数学'] },
        },
      ]),
      { current: current() },
    )
    expect(r.ok).toBe(true)
    expect(r.after?.entities[0]?.fields.find((f) => f.id === 'major')?.options).toContain('物理')
    expect(r.notes[0]?.kind).toBe('optionAlreadyExists')
  })

  it('rejects a new required field without a default (old records would become invalid)', () => {
    const r = validateProposal(
      patch([
        {
          op: 'addField',
          entityId: 'attendee',
          field: { id: 'grade', label: '年级', type: 'string', required: true },
        },
      ]),
      { current: current() },
    )
    expect(r.issues[0]?.code).toBe('SAFETY_REQUIRED_WITHOUT_DEFAULT')
  })

  it('validates the resulting definition and prefixes issues with "result."', () => {
    const r = validateProposal(
      patch([{ op: 'addNode', node: { id: 'late', type: 'Table', params: { columns: ['name'] } } }]),
      { current: current() },
    )
    expect(r.issues[0]).toMatchObject({ code: 'GRAPH_INPUT_UNBOUND', path: 'result.nodes[6]' })
  })

  it('reports structural errors inside an op with the op index', () => {
    const r = validateProposal(patch([{ op: 'moveNode', nodeId: 'roster', region: 'left', order: 1 }]), {
      current: current(),
    })
    expect(r.issues[0]).toMatchObject({ layer: 'schema', path: 'operations[0].region' })
  })

  it('accepts refusals without further checks', () => {
    const r = validateProposal({
      kind: 'refusal',
      intent: '删库',
      reason: '不能删除业务数据',
      suggestion: '改为隐藏',
    })
    expect(r.ok).toBe(true)
  })
})

describe('applyPatch', () => {
  it('is atomic: a failing op leaves the base definition untouched', () => {
    const base = eventDef()
    const snapshot = JSON.stringify(base)
    const ops: PatchOp[] = [
      { op: 'hideNode', nodeId: 'byMajor' },
      { op: 'moveNode', nodeId: 'ghost', region: 'main', order: 1 },
    ]
    const r = applyPatch(base, ops)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('cascades bindings when removing a node and reports it', () => {
    const r = applyPatch(eventDef(), [{ op: 'removeNode', nodeId: 'roster' }])
    expect(r.ok && r.definition.bindings.some((b) => b.to.node === 'roster')).toBe(false)
    expect(r.ok && r.notes[0]?.message).toContain('b_roster')
  })

  it('refuses setFilter on non-Filter nodes', () => {
    const r = applyPatch(eventDef(), [
      { op: 'setFilter', nodeId: 'roster', filter: { field: 'name', operator: 'notEmpty' } },
    ])
    expect(!r.ok && r.issues[0]?.code).toBe('TYPE_NOT_FILTER')
  })
})
