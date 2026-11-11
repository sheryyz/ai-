import { describe, expect, it } from 'vitest'
import type { Row } from './filter'
import { validateProposal } from './proposal'
import {
  asRows,
  evaluateGraph,
  groupCounts,
  layoutNodes,
  materialize,
  renderTemplate,
  resolveSet,
  toCSV,
  validateRecordInput,
} from './runtime'
import { CTX, checkinProposal, equipmentDef, eventDef, row } from './test-helpers'

describe('virtual default fill (ADR-0002)', () => {
  it('reads missing fields as their default without touching stored data', () => {
    const def = validateProposal(checkinProposal(), { current: { definition: eventDef(), version: 1 } })
      .after!
    const stored = {
      id: 'a',
      data: { name: '张三', major: '计算机', legacy: 'kept' },
      createdAt: 't',
      updatedAt: 't',
    }
    const r = materialize(stored, def.entities[0]!)
    expect(r.values.checkedIn).toBe(false)
    expect(r.values.phone).toBeNull()
    expect(r.values).not.toHaveProperty('legacy')
    expect(stored.data).not.toHaveProperty('checkedIn')
  })
})

describe('validateRecordInput', () => {
  const entity = equipmentDef().entities[0]!

  it('coerces, applies defaults on create and reports every problem', () => {
    const ok = validateRecordInput(
      entity,
      { name: ' 示波器 A ', code: 'OSC-01', category: '示波器' },
      'create',
    )
    expect(ok).toEqual({
      ok: true,
      values: { name: '示波器 A', code: 'OSC-01', category: '示波器', status: '可借用' },
    })
    const bad = validateRecordInput(
      entity,
      { name: '', category: '桌子', borrowedAt: '2026-13-01', id: 'x' },
      'create',
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok)
      expect(bad.errors.map((e) => e.field).sort()).toEqual(['borrowedAt', 'category', 'code', 'id', 'name'])
  })

  it('on update only checks provided keys and rejects unknown fields', () => {
    expect(validateRecordInput(entity, { status: '已借出' }, 'update')).toEqual({
      ok: true,
      values: { status: '已借出' },
    })
    expect(validateRecordInput(entity, { colour: 'red' }, 'update').ok).toBe(false)
  })
})

describe('evaluateGraph', () => {
  const def = validateProposal(checkinProposal(), { current: { definition: eventDef(), version: 1 } }).after!
  const rows: Row[] = [
    row({ name: '甲', studentId: '1', major: '计算机', phone: null, checkedIn: false }),
    row({ name: '乙', studentId: '2', major: '计算机', phone: null, checkedIn: true }),
    row({ name: '丙', studentId: '3', major: '数学', phone: null, checkedIn: false }),
    row({ name: '丁', studentId: '4', major: '计算机', phone: null, checkedIn: false }),
  ]

  it('propagates record sets along bindings: source → filter → message recipients', () => {
    const g = evaluateGraph(def, rows, CTX)
    expect(asRows(g.get('remind')?.inputs.recipients).map((r) => r.values.name)).toEqual(['甲', '丁'])
    expect(g.get('total')?.outputs.value).toBe(4)
    expect(g.get('rate')?.outputs.value).toBe(0.25)
  })

  it('applies `where` as a pre-filter for count metrics (equipment)', () => {
    const eq = equipmentDef()
    const g = evaluateGraph(
      eq,
      [row({ status: '可借用' }), row({ status: '已借出' }), row({ status: '可借用' })],
      CTX,
    )
    expect(g.get('available')?.outputs.value).toBe(2)
    expect(g.get('lent')?.outputs.value).toBe(1)
  })
})

describe('presentation helpers', () => {
  const entity = eventDef().entities[0]!

  it('groups enum values in option order including zero counts', () => {
    const groups = groupCounts(
      [row({ major: '数学' }), row({ major: '数学' }), row({ major: null })],
      entity.fields[2]!,
    )
    expect(groups.slice(0, 5).map((g) => g.count)).toEqual([0, 0, 0, 0, 2])
    expect(groups.at(-1)).toMatchObject({ label: '（空）', count: 1 })
  })

  it('renders message templates per recipient', () => {
    expect(renderTemplate('{{name}} 同学（{{ major }}）', row({ name: '甲', major: '计算机' }), entity)).toBe(
      '甲 同学（计算机）',
    )
  })

  it('exports CSV with BOM, escaping and formula-injection guard (AC-11)', () => {
    const csv = toCSV(
      [row({ name: '=HYPERLINK("x")', studentId: '1, 2', major: '计算机' })],
      ['name', 'studentId', 'major'],
      entity,
    )
    expect(csv.startsWith('﻿姓名,学号,专业\r\n')).toBe(true)
    expect(csv).toContain(`"'=HYPERLINK(""x"")","1, 2",计算机`)
  })

  it('resolves $today tokens and lets asked values override', () => {
    expect(resolveSet({ status: '已借出', borrowedAt: '$today' }, { borrower: '王老师' }, CTX)).toEqual({
      status: '已借出',
      borrowedAt: '2026-11-11',
      borrower: '王老师',
    })
  })

  it('lays out visible visual nodes by region and order', () => {
    const l = layoutNodes(eventDef())
    expect(l.main.map((n) => n.id)).toEqual(['total', 'byMajor', 'roster'])
    expect(l.aside.map((n) => n.id)).toEqual(['signup', 'exportAll'])
  })
})

describe('business time zone (ADR-0005)', () => {
  it('computes the calendar date in the configured zone, not the host zone', async () => {
    const { localDate, formatTimestamp } = await import('./runtime')
    const instant = new Date('2026-11-10T18:30:00Z') // 02:30 on Nov 11 in Beijing, Nov 10 in UTC / PST
    expect(localDate(instant, 'Asia/Shanghai')).toBe('2026-11-11')
    expect(localDate(instant, 'UTC')).toBe('2026-11-10')
    expect(formatTimestamp(instant.toISOString(), 'Asia/Shanghai')).toBe('2026-11-11 02:30')
  })
})
