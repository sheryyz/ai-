import { describe, expect, it } from 'vitest'
import samples from '../../../fixtures/samples/event-registration.json'
import type { Row } from './filter'
import { CTX, patchOn, row, withDesk } from './test-helpers'
import { snapshotView, trimRow } from './view-snapshot'

/** The fictional sample registrants, the first two already checked in. */
const rows = (): Row[] =>
  samples.records.map((r, i) =>
    row(
      { ...r, phone: r.phone ?? null, checkedIn: i < 2 } as Row['values'],
      new Date(Date.UTC(2026, 10, 10, 9, i)).toISOString(),
    ),
  )
const N = samples.records.length
const phones = samples.records.map((r) => r.phone).filter((p): p is string => Boolean(p))
const names = (list: Row[]) => list.map((r) => r.values.name).sort()

describe('snapshotView (protocol §11.4)', () => {
  it('AC-16: a check-in desk receives names of eligible people and a rate — never phone numbers', () => {
    const snap = snapshotView(withDesk(), 'desk', rows(), CTX)!
    const json = JSON.stringify(snap)
    for (const p of phones) expect(json).not.toContain(p)
    for (const r of samples.records) expect(json).not.toContain(r.studentId)

    // Only the fields the page uses travel; the phone field is not even described.
    expect(snap.entity.fields.map((f) => f.id)).toEqual(['name', 'checkedIn'])

    const byId = Object.fromEntries(snap.nodes.map((n) => [n.node.id, n]))
    expect(snap.nodes.map((n) => n.node.id)).toEqual(['deskRate', 'deskAction', 'deskPending'])
    expect(byId.deskRate?.data).toEqual({ kind: 'metric', value: 2 / N, matched: 2, count: N })
    expect(byId.deskPending?.data).toEqual({ kind: 'count', count: N - 2, total: N })

    const action = byId.deskAction!
    expect(action.data.kind).toBe('rows')
    const actionRows = action.data.kind === 'rows' ? action.data.rows : []
    expect(names(actionRows)).toEqual(names(rows().slice(2)))
    for (const r of actionRows) {
      expect(r).toEqual({
        id: expect.any(String),
        createdAt: '',
        updatedAt: '',
        values: { name: expect.any(String) },
      })
    }
  })

  it('applies availableWhen on the server and strips it, so its fields never reach the page', () => {
    const def = patchOn(withDesk(), [
      { op: 'unbind', bindingId: 'b_da' },
      {
        op: 'bind',
        binding: {
          id: 'b_da2',
          from: { node: 'source', port: 'records' },
          to: { node: 'deskAction', port: 'rows' },
        },
      },
      {
        op: 'updateNode',
        nodeId: 'deskAction',
        params: { availableWhen: { field: 'major', operator: 'eq', value: '软件工程' } },
      },
    ]).after!
    const snap = snapshotView(def, 'desk', rows(), CTX)!
    const action = snap.nodes.find((n) => n.node.id === 'deskAction')!
    expect(action.node.params).not.toHaveProperty('availableWhen')
    expect(names(action.data.kind === 'rows' ? action.data.rows : [])).toEqual(
      names(rows().filter((r) => r.values.major === '软件工程')),
    )
    expect(JSON.stringify(snap)).not.toContain('软件工程')
    expect(snap.entity.fields.map((f) => f.id)).not.toContain('major')
  })

  it('sends statistics as counts, never as rows a viewer could line up with a table', () => {
    const def = patchOn(withDesk(), [
      {
        op: 'addNode',
        node: { id: 'deskMajors', type: 'Chart', view: 'desk', order: 3, params: { groupBy: 'major' } },
      },
      {
        op: 'bind',
        binding: {
          id: 'b_dm',
          from: { node: 'source', port: 'records' },
          to: { node: 'deskMajors', port: 'rows' },
        },
      },
    ]).after!
    const chart = snapshotView(def, 'desk', rows(), CTX)!.nodes.find((n) => n.node.id === 'deskMajors')!
    expect(chart.data.kind).toBe('groups')
    expect(chart.data).not.toHaveProperty('rows')
    expect(
      chart.data.kind === 'groups' ? chart.data.groups.find((g) => g.key === '软件工程')?.count : 0,
    ).toBe(samples.records.filter((r) => r.major === '软件工程').length)
  })

  it('returns undefined for an unknown view and keeps timestamps only when read', () => {
    expect(snapshotView(withDesk(), 'nope', rows(), CTX)).toBeUndefined()
    const r = rows()[0]!
    expect(trimRow(r, ['name', 'createdAt'])).toEqual({
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: '',
      values: { name: r.values.name },
    })
  })
})
