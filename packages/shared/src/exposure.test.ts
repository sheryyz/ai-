import { describe, expect, it } from 'vitest'
import { computeDiff } from './diff'
import { computeExposure, upstreamFilters } from './exposure'
import { applyPatch } from './patch'
import { validateProposal } from './proposal'
import { layoutNodes } from './runtime'
import type { AppDefinition } from './schema'
import { deskOps, eventDef, patchOn, rawEvent, signupPageOps, withCheckin, withDesk } from './test-helpers'
import { validateDefinition } from './validate'

const run = patchOn
const errors = (r: ReturnType<typeof run>) => r.issues.filter((i) => i.level === 'error')
const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => i.code)
const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id)
const diff = (before: AppDefinition, after: AppDefinition) =>
  computeDiff(before, after, { fromVersion: 1, recordCount: 6 })
const signupPage = signupPageOps() as { node?: Record<string, unknown> }[]

const exportOnDesk = (params: Record<string, unknown>) => [
  { op: 'addNode', node: { id: 'deskExport', type: 'CSVExport', view: 'desk', order: 2, params } },
  {
    op: 'bind',
    binding: {
      id: 'b_de',
      from: { node: 'source', port: 'records' },
      to: { node: 'deskExport', port: 'rows' },
    },
  },
]

describe('role views (protocol §2.2, §3.1)', () => {
  it('AC-15: a sign-up page is a view holding a form; the admin page layout is unchanged', () => {
    const before = eventDef()
    const r = run(before, signupPage)
    expect(errors(r)).toEqual([])
    expect(codes(r).filter((c) => c.startsWith('EXPOSURE'))).toEqual([])
    const after = r.after!

    expect(layoutNodes(after)).toEqual(layoutNodes(before))
    expect(ids(layoutNodes(after, { view: 'signupPage' }).main)).toEqual(['publicForm'])

    expect(computeExposure(after, 'signupPage')).toMatchObject({
      label: '报名页',
      audience: '报名的同学',
      read: [],
      aggregate: [],
      write: ['name', 'studentId', 'major', 'phone'],
      canCreate: true,
      // Filling in one's own phone number is not exposure (protocol §11.3).
      sensitiveRead: [],
    })

    const d = diff(before, after)
    expect(d.views.added.map((v) => v.id)).toEqual(['signupPage'])
    expect(d.exposure).toHaveLength(1)
    expect(d.exposure[0]).toMatchObject({
      before: null,
      newlyRead: [],
      newlyWritable: ['name', 'studentId', 'major', 'phone'],
      newlySensitive: [],
      changed: true,
    })
    expect(d.confirmExposure).toBe(false)
    expect(d.risk).toBe('low')
    expect(d.summary).toBe('新增 1 个分享页，新增 1 个组件')
  })

  it('v1 definitions without views parse back unchanged and diff to nothing', () => {
    const def = eventDef()
    expect('views' in def).toBe(false)
    expect(validateDefinition(def).definition).toEqual(def)
    const d = diff(def, def)
    expect(d.isEmpty).toBe(true)
    expect(d.exposure).toEqual([])
  })

  it('rejects dangling view references at L2', () => {
    const r = run(eventDef(), [
      { op: 'addNode', node: { ...signupPage[1]!.node, view: 'nowhere' } },
      { op: 'addView', view: { id: 'v2', label: '页', audience: '人', restrictedFields: ['nope'] } },
    ])
    expect(errors(r).map((i) => [i.layer, i.code, i.path])).toEqual([
      ['reference', 'REF_MISSING_FIELD', 'result.views[0].restrictedFields[0]'],
      ['reference', 'REF_MISSING_VIEW', 'result.nodes[6].view'],
    ])

    const d = rawEvent()
    d.views = [{ id: 'p', label: '页', audience: '人' }]
    d.nodes[0]!.view = 'p'
    expect(validateDefinition(d).issues.map((i) => i.code)).toContain('REF_VIEW_NOT_ALLOWED')

    const dup = applyPatch(eventDef(), [signupPage[0], signupPage[0]] as never)
    expect(dup.ok ? [] : dup.issues.map((i) => i.code)).toEqual(['REF_DUPLICATE_ID'])
  })

  it('warns when a view has no visible component (its link would show as inactive)', () => {
    const r = run(eventDef(), [signupPage[0]])
    expect(r.ok).toBe(true)
    expect(r.issues.map((i) => [i.level, i.code])).toEqual([['warning', 'EXPOSURE_VIEW_EMPTY']])
  })
})

describe('computeExposure (protocol §11.1)', () => {
  it('splits a check-in desk into row-level reads, aggregates, writes and record scope', () => {
    const r = run(withCheckin(), deskOps())
    expect(errors(r)).toEqual([])
    const e = computeExposure(r.after!, 'desk')!
    expect(e).toMatchObject({
      read: ['name'],
      aggregate: ['checkedIn'],
      write: ['checkedIn'],
      canCreate: false,
      sensitiveRead: [],
      restricted: ['phone'],
    })
    // Page order follows `order`; the Filter has none and goes last.
    expect(e.nodes.map((n) => [n.nodeId, n.filters])).toEqual([
      ['deskRate', []],
      ['deskAction', ['未签到']],
      ['deskPending', []],
    ])
  })

  it('follows filters upstream across pages and ignores hidden components', () => {
    const def = withCheckin()
    expect(upstreamFilters(def, 'remind')).toEqual(['计算机专业未签到'])
    const hidden = run(withDesk(), [{ op: 'hideNode', nodeId: 'deskAction' }]).after!
    expect(computeExposure(hidden, 'desk')).toMatchObject({ read: [], write: [] })
  })
})

describe('L7 exposure (protocol §11.2)', () => {
  it('AC-18: a restricted field may not reach the view row by row, but may feed a statistic', () => {
    const r = run(withDesk(), exportOnDesk({ filename: '名单' }))
    expect(r.ok).toBe(false)
    const restricted = errors(r).filter((i) => i.code === 'EXPOSURE_RESTRICTED_FIELD')
    expect(restricted).toHaveLength(1)
    expect(restricted[0]).toMatchObject({ layer: 'exposure', path: 'result.nodes[13].params' })
    expect(restricted[0]?.message).toContain('门口志愿者')
    expect(restricted[0]?.message).toContain('手机号')
    // Omitted columns means "every field" — the hint tells the model exactly that.
    expect(restricted[0]?.hint).toContain('columns')

    const stat = run(withDesk(), [
      {
        op: 'updateNode',
        nodeId: 'deskRate',
        params: { aggregate: 'ratio', where: { field: 'phone', operator: 'notEmpty' } },
      },
    ])
    expect(errors(stat)).toEqual([])
  })

  it('AC-18: writing a restricted field is rejected too', () => {
    const r = run(withDesk(), [{ op: 'updateNode', nodeId: 'deskAction', params: { ask: ['phone'] } }])
    expect(errors(r).map((i) => i.code)).toEqual(['EXPOSURE_RESTRICTED_FIELD'])
    expect(errors(r)[0]?.message).toContain('修改')
  })

  it('AC-17: showing a sensitive field row by row is a warning that the Diff turns into a required confirmation', () => {
    const before = withDesk()
    const r = run(before, exportOnDesk({ filename: '名单', columns: ['name', 'studentId'] }))
    expect(r.ok).toBe(true)
    const warn = r.issues.find((i) => i.code === 'EXPOSURE_SENSITIVE_FIELD')
    expect(warn).toMatchObject({ level: 'warning', layer: 'exposure', path: 'result.views[0]' })
    expect(warn?.message).toContain('学号')

    const d = diff(before, r.after!)
    expect(d.exposure[0]).toMatchObject({ newlyRead: ['studentId'], newlySensitive: ['studentId'] })
    expect(d.confirmExposure).toBe(true)
    expect(d.risk).toBe('high')
  })

  it('AC-19: tables on a share page default to read-only; opening edit or delete is rejected', () => {
    const table = (params: Record<string, unknown>) => [
      signupPage[0],
      { op: 'addNode', node: { id: 'list', type: 'Table', view: 'signupPage', params } },
      {
        op: 'bind',
        binding: {
          id: 'b_list',
          from: { node: 'source', port: 'records' },
          to: { node: 'list', port: 'rows' },
        },
      },
    ]
    const ok = run(eventDef(), table({ columns: ['name', 'major'] }))
    expect(errors(ok)).toEqual([])
    expect(ok.after!.nodes.find((n) => n.id === 'list')?.params).toMatchObject({
      editable: false,
      allowDelete: false,
    })
    expect(computeExposure(ok.after!, 'signupPage')).toMatchObject({ read: ['name', 'major'], write: [] })
    // Re-validating the normalized definition keeps it read-only (idempotent).
    expect(validateDefinition(ok.after).ok).toBe(true)

    const edit = run(eventDef(), table({ columns: ['name'], editable: true }))
    expect(errors(edit).map((i) => [i.code, i.path])).toEqual([
      ['EXPOSURE_FREE_EDIT', 'result.nodes[6].params.editable'],
    ])
    const del = run(ok.after!, [{ op: 'updateNode', nodeId: 'list', params: { allowDelete: true } }])
    expect(errors(del).map((i) => i.code)).toEqual(['EXPOSURE_FREE_EDIT'])
  })
})

describe('view patches and the exposure Diff (protocol §6.1, §8)', () => {
  it('removeView takes its components and bindings with it and warns that the link stops working', () => {
    const before = withDesk()
    const r = run(before, [{ op: 'removeView', viewId: 'desk' }])
    expect(errors(r)).toEqual([])
    expect(r.notes.map((n) => n.kind)).toEqual(['cascadeRemoveViewNodes'])
    const after = r.after!
    expect(after.views).toBeUndefined()
    expect(after.nodes.some((n) => n.view)).toBe(false)
    expect(after.bindings.map((b) => b.id)).not.toContain('b_da')
    expect(after).toEqual(withCheckin())

    const d = diff(before, after)
    expect(d.views.removed.map((v) => v.id)).toEqual(['desk'])
    expect(d.impacts.map((i) => i.kind)).toContain('viewRemoved')
    expect(d.exposure[0]).toMatchObject({ viewId: 'desk', after: null, changed: true })
    expect(d.risk).toBe('medium')
    expect(d.confirmExposure).toBe(false)
  })

  it('lifting a restriction to expose the field needs confirmation', () => {
    const before = withDesk()
    const r = run(before, [
      { op: 'updateView', viewId: 'desk', changes: { restrictedFields: [] } },
      { op: 'updateNode', nodeId: 'deskAction', params: { searchFields: ['name', 'phone'] } },
    ])
    expect(errors(r)).toEqual([])
    const d = diff(before, r.after!)
    expect(d.views.changed).toEqual([
      {
        viewId: 'desk',
        label: '签到台',
        changes: [{ key: 'restrictedFields', before: ['phone'], after: undefined }],
      },
    ])
    expect(d.exposure[0]).toMatchObject({
      newlyRead: ['phone'],
      newlySensitive: ['phone'],
      loosened: ['phone'],
    })
    expect(d.confirmExposure).toBe(true)
  })

  it('unmarking a sensitive field that a view shows counts as loosening', () => {
    const before = run(withDesk(), exportOnDesk({ filename: '名单', columns: ['name', 'studentId'] })).after!
    const r = run(before, [
      { op: 'updateField', entityId: 'attendee', fieldId: 'studentId', changes: { sensitive: false } },
    ])
    expect(errors(r)).toEqual([])
    expect(r.after!.entities[0]!.fields.find((f) => f.id === 'studentId')).not.toHaveProperty('sensitive')
    const d = diff(before, r.after!)
    expect(d.fields.changed[0]?.changes).toEqual([{ key: 'sensitive', before: true, after: undefined }])
    expect(d.exposure[0]).toMatchObject({ newlySensitive: [], loosened: ['studentId'] })
    expect(d.confirmExposure).toBe(true)
  })

  it('a create proposal that already exposes a sensitive field asks for confirmation', () => {
    const def = rawEvent()
    def.views = [{ id: 'roll', label: '名单页', audience: '所有报名者' }]
    def.nodes.push({
      id: 'publicRoster',
      type: 'Table',
      view: 'roll',
      params: { columns: ['name', 'phone'] },
    })
    def.bindings.push({
      id: 'b_pr',
      from: { node: 'source', port: 'records' },
      to: { node: 'publicRoster', port: 'rows' },
    })
    const r = validateProposal({ kind: 'create', intent: 'x', summary: 'x', definition: def })
    expect(r.ok).toBe(true)
    const d = computeDiff(null, r.after!, { fromVersion: 0, recordCount: 0 })
    expect(d.summary).toContain('1 个分享页')
    expect(d.exposure[0]).toMatchObject({ before: null, newlySensitive: ['phone'] })
    expect(d.confirmExposure).toBe(true)
  })
})
