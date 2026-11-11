import { describe, expect, it } from 'vitest'
import { equipmentDef, eventDef, rawEvent } from './test-helpers'
import { validateDefinition } from './validate'

const codes = (raw: unknown) =>
  validateDefinition(raw)
    .issues.filter((i) => i.level === 'error')
    .map((i) => i.code)

describe('templates', () => {
  it('both scenario templates pass all layers (same engine, two domains)', () => {
    for (const def of [eventDef(), equipmentDef()]) {
      const r = validateDefinition(def)
      expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
      expect(r.ok).toBe(true)
    }
  })

  it('normalizes component params with registry defaults', () => {
    const def = eventDef()
    const form = def.nodes.find((n) => n.id === 'signup')
    expect(form?.params).toMatchObject({ submitLabel: '提交报名' })
    const chart = def.nodes.find((n) => n.id === 'byMajor')
    expect(chart?.params).toMatchObject({ kind: 'bar', groupBy: 'major' })
  })
})

describe('L1 schema', () => {
  it('rejects unknown component types and bad slugs with paths', () => {
    const d = rawEvent()
    ;(d.nodes[1] as { type: string }).type = 'Kanban'
    d.entities[0]!.fields[0]!.id = 'Bad-Id'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['nodes[1].type', 'entities[0].fields[0].id']),
    )
    expect(r.issues.every((i) => i.layer === 'schema')).toBe(true)
  })

  it('validates component params against the registry', () => {
    const d = rawEvent()
    d.nodes.find((n) => n.id === 'roster')!.params = { columns: [] }
    const r = validateDefinition(d)
    expect(r.issues[0]).toMatchObject({ layer: 'schema', path: 'nodes[3].params.columns' })
  })

  it('limits apps to one entity in this version', () => {
    const d = rawEvent()
    d.entities.push(structuredClone(d.entities[0]!))
    expect(codes(d)).toContain('SCHEMA_INVALID')
  })
})

describe('L2 references', () => {
  it('reports a missing field with the list of available fields', () => {
    const d = rawEvent()
    d.nodes.find((n) => n.id === 'roster')!.params.columns = ['name', 'email']
    const r = validateDefinition(d)
    const i = r.issues.find((x) => x.code === 'REF_MISSING_FIELD')
    expect(i).toMatchObject({ layer: 'reference', path: 'nodes[3].params.columns[1]' })
    expect(i?.hint).toContain('studentId(学号)')
  })

  it('rejects reserved ids as user fields and in forms', () => {
    const d = rawEvent()
    d.entities[0]!.fields.push({ id: 'createdAt', label: '时间', type: 'date', required: false })
    d.nodes.find((n) => n.id === 'signup')!.params.fields = ['name', 'studentId', 'major', 'id']
    expect(codes(d).filter((c) => c === 'REF_RESERVED_ID')).toHaveLength(2)
  })

  it('rejects duplicate node ids and bindings to missing nodes', () => {
    const d = rawEvent()
    d.nodes.push({ ...d.nodes[1]! })
    d.bindings.push({
      id: 'b_x',
      from: { node: 'ghost', port: 'records' },
      to: { node: 'roster', port: 'rows' },
    })
    expect(codes(d)).toEqual(expect.arrayContaining(['REF_DUPLICATE_ID', 'REF_MISSING_NODE']))
  })
})

describe('L3 types', () => {
  it('AC-05: rejects binding a Number output into a RecordSet input', () => {
    const d = rawEvent()
    d.bindings.find((b) => b.id === 'b_roster')!.from = { node: 'total', port: 'value' }
    const r = validateDefinition(d)
    const i = r.issues.find((x) => x.code === 'TYPE_PORT_MISMATCH')
    expect(i?.message).toContain('total.value 输出 Number')
    expect(i?.message).toContain('RecordSet<attendee>')
  })

  it('explains port direction mistakes', () => {
    const d = rawEvent()
    d.bindings.find((b) => b.id === 'b_roster')!.from = { node: 'total', port: 'rows' }
    expect(codes(d)).toContain('TYPE_PORT_DIRECTION')
  })

  it('checks operators and enum values against field types', () => {
    const d = rawEvent()
    d.nodes.push({
      id: 'f1',
      type: 'Filter',
      params: {
        filter: {
          op: 'and',
          conditions: [
            { field: 'major', operator: 'gt', value: '计算机' },
            { field: 'major', operator: 'eq', value: '物理' },
          ],
        },
      },
    })
    d.bindings.push({
      id: 'b_f1',
      from: { node: 'source', port: 'records' },
      to: { node: 'f1', port: 'input' },
    })
    const r = validateDefinition(d)
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['TYPE_OPERATOR_INVALID', 'TYPE_ENUM_VALUE_INVALID']),
    )
    expect(r.issues.find((i) => i.code === 'TYPE_ENUM_VALUE_INVALID')?.hint).toContain('计算机')
  })

  it('requires forms to include required fields without defaults', () => {
    const d = rawEvent()
    d.nodes.find((n) => n.id === 'signup')!.params.fields = ['name', 'major']
    const r = validateDefinition(d)
    expect(r.issues.find((i) => i.code === 'TYPE_FORM_MISSING_REQUIRED')?.message).toContain('studentId')
  })

  it('requires ratio metrics to declare the numerator condition', () => {
    const d = rawEvent()
    d.nodes.find((n) => n.id === 'total')!.params = { label: '比例', aggregate: 'ratio', format: 'percent' }
    expect(codes(d)).toContain('TYPE_METRIC_WHERE_MISSING')
  })

  it('validates QuickAction set values, allowing $today only for dates', () => {
    const def = equipmentDef()
    const lend = def.nodes.find((n) => n.id === 'lend')!
    lend.params = { ...lend.params, set: { status: '丢失', borrower: '$today' } }
    const r = validateDefinition(def)
    expect(r.issues.map((i) => i.code)).toContain('TYPE_ENUM_VALUE_INVALID')
    expect(r.ok).toBe(false)
  })
})

describe('L4 graph', () => {
  it('reports unbound required inputs with a ready-to-use binding hint', () => {
    const d = rawEvent()
    d.bindings = d.bindings.filter((b) => b.id !== 'b_roster')
    const i = validateDefinition(d).issues.find((x) => x.code === 'GRAPH_INPUT_UNBOUND')
    expect(i?.hint).toContain('"roster"')
  })

  it('rejects two bindings into one input port', () => {
    const d = rawEvent()
    d.bindings.push({
      id: 'b_dup',
      from: { node: 'source', port: 'records' },
      to: { node: 'roster', port: 'rows' },
    })
    expect(codes(d)).toContain('GRAPH_INPUT_MULTI')
  })

  it('AC-06: rejects a cycle and names the nodes on it', () => {
    const d = rawEvent()
    d.nodes.push(
      { id: 'fa', type: 'Filter', params: { filter: { field: 'name', operator: 'notEmpty' } } },
      { id: 'fb', type: 'Filter', params: { filter: { field: 'name', operator: 'notEmpty' } } },
    )
    d.bindings.push(
      { id: 'b_ab', from: { node: 'fa', port: 'result' }, to: { node: 'fb', port: 'input' } },
      { id: 'b_ba', from: { node: 'fb', port: 'result' }, to: { node: 'fa', port: 'input' } },
    )
    const i = validateDefinition(d).issues.find((x) => x.code === 'GRAPH_CYCLE')
    expect(i?.message).toMatch(/fa → fb → fa|fb → fa → fb/)
  })

  it('warns (not errors) about an unused data source', () => {
    const d = rawEvent()
    d.nodes.push({ id: 'src2', type: 'CollectionSource', params: { entityId: 'attendee' } })
    const r = validateDefinition(d)
    expect(r.ok).toBe(true)
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_UNUSED_SOURCE', level: 'warning' }),
    )
  })
})
