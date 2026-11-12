/**
 * protocol.md §6.3 — applyPatch: pure and atomic. Any failing op fails the whole patch.
 * Structural/type validity of the *result* is checked afterwards by validateDefinition.
 */
import { isReservedFieldId } from './ids'
import { issue, type ValidationIssue } from './issues'
import type { AppDefinition, PatchOp } from './schema'

export interface ApplyNote {
  opIndex: number
  kind: 'cascadeUnbind' | 'cascadeRemoveViewNodes' | 'optionAlreadyExists'
  message: string
}

export type ApplyResult =
  | { ok: true; definition: AppDefinition; notes: ApplyNote[] }
  | { ok: false; issues: ValidationIssue[] }

export function applyPatch(base: AppDefinition, ops: readonly PatchOp[]): ApplyResult {
  const def = structuredClone(base)
  const notes: ApplyNote[] = []
  const issues: ValidationIssue[] = []

  /** Applies one op in place; returns false (after recording an issue) when it cannot be applied. */
  const applyOne = (op: PatchOp, i: number): boolean => {
    const p = (...rest: (string | number)[]) => ['operations', i, ...rest]
    const fail = (
      layer: ValidationIssue['layer'],
      code: string,
      path: (string | number)[],
      msg: string,
      hint?: string,
    ): false => {
      issues.push(issue(layer, code, path, msg, hint))
      return false
    }
    const findNode = (id: string, field = 'nodeId') => {
      const n = def.nodes.find((x) => x.id === id)
      if (!n)
        fail(
          'reference',
          'REF_MISSING_NODE',
          p(field),
          `节点「${id}」不存在`,
          `现有节点：${def.nodes.map((x) => x.id).join('、')}`,
        )
      return n
    }
    const findView = (id: string) => {
      const v = def.views?.find((x) => x.id === id)
      if (!v)
        fail(
          'reference',
          'REF_MISSING_VIEW',
          p('viewId'),
          `分享页「${id}」不存在`,
          def.views?.length ? `现有分享页：${def.views.map((x) => x.id).join('、')}` : '当前应用还没有分享页',
        )
      return v
    }

    switch (op.op) {
      case 'addField': {
        const entity = def.entities.find((e) => e.id === op.entityId)
        if (!entity)
          return fail('reference', 'REF_MISSING_ENTITY', p('entityId'), `实体「${op.entityId}」不存在`)
        if (isReservedFieldId(op.field.id)) {
          return fail('reference', 'REF_RESERVED_ID', p('field', 'id'), `「${op.field.id}」是系统保留字段`)
        }
        if (entity.fields.some((f) => f.id === op.field.id)) {
          return fail(
            'reference',
            'REF_DUPLICATE_ID',
            p('field', 'id'),
            `字段「${op.field.id}」已存在`,
            '如需修改显示名称请用 updateField',
          )
        }
        if (op.field.required && op.field.default === undefined) {
          return fail(
            'safety',
            'SAFETY_REQUIRED_WITHOUT_DEFAULT',
            p('field'),
            `新增必填字段「${op.field.label}」必须提供 default，否则已有记录将不再合法`,
            '设置 default，或把 required 设为 false',
          )
        }
        entity.fields.push(structuredClone(op.field))
        return true
      }
      case 'updateField': {
        const entity = def.entities.find((e) => e.id === op.entityId)
        if (!entity)
          return fail('reference', 'REF_MISSING_ENTITY', p('entityId'), `实体「${op.entityId}」不存在`)
        const f = entity.fields.find((x) => x.id === op.fieldId)
        if (!f) return fail('reference', 'REF_MISSING_FIELD', p('fieldId'), `字段「${op.fieldId}」不存在`)
        const c = op.changes
        if (c.label !== undefined) f.label = c.label
        if (c.description !== undefined) f.description = c.description
        if (c.default !== undefined) f.default = c.default
        if (c.sensitive === true) f.sensitive = true
        else if (c.sensitive === false) delete f.sensitive
        if (c.addOptions) {
          if (f.type !== 'enum') {
            return fail(
              'type',
              'TYPE_OPTIONS_NOT_ENUM',
              p('changes', 'addOptions'),
              `字段「${f.label}」不是单选字段，不能添加选项`,
            )
          }
          const existing = new Set(f.options ?? [])
          for (const o of c.addOptions) {
            if (existing.has(o)) {
              notes.push({ opIndex: i, kind: 'optionAlreadyExists', message: `选项「${o}」已存在，已忽略` })
            } else {
              existing.add(o)
            }
          }
          f.options = [...existing]
        }
        return true
      }
      case 'addNode': {
        if (def.nodes.some((n) => n.id === op.node.id)) {
          return fail(
            'reference',
            'REF_DUPLICATE_ID',
            p('node', 'id'),
            `节点「${op.node.id}」已存在`,
            '换一个新的节点 id，或用 updateNode 修改已有节点',
          )
        }
        def.nodes.push(structuredClone(op.node))
        return true
      }
      case 'updateNode': {
        const n = findNode(op.nodeId)
        if (!n) return false
        if (op.title !== undefined) n.title = op.title
        if (op.params) n.params = { ...n.params, ...structuredClone(op.params) }
        return true
      }
      case 'moveNode': {
        const n = findNode(op.nodeId)
        if (!n) return false
        n.region = op.region
        n.order = op.order
        if (op.width) n.width = op.width
        return true
      }
      case 'hideNode':
      case 'showNode': {
        const n = findNode(op.nodeId)
        if (!n) return false
        if (op.op === 'hideNode') n.hidden = true
        else delete n.hidden
        return true
      }
      case 'removeNode': {
        const n = findNode(op.nodeId)
        if (!n) return false
        def.nodes = def.nodes.filter((x) => x.id !== op.nodeId)
        const cut = def.bindings.filter((b) => b.from.node === op.nodeId || b.to.node === op.nodeId)
        if (cut.length) {
          def.bindings = def.bindings.filter((b) => !cut.includes(b))
          notes.push({
            opIndex: i,
            kind: 'cascadeUnbind',
            message: `移除节点「${op.nodeId}」同时断开了 ${cut.length} 条绑定：${cut.map((b) => b.id).join('、')}`,
          })
        }
        return true
      }
      case 'bind': {
        if (def.bindings.some((b) => b.id === op.binding.id)) {
          return fail('reference', 'REF_DUPLICATE_ID', p('binding', 'id'), `绑定「${op.binding.id}」已存在`)
        }
        def.bindings.push(structuredClone(op.binding))
        return true
      }
      case 'unbind': {
        if (!def.bindings.some((b) => b.id === op.bindingId)) {
          return fail('reference', 'REF_MISSING_BINDING', p('bindingId'), `绑定「${op.bindingId}」不存在`)
        }
        def.bindings = def.bindings.filter((b) => b.id !== op.bindingId)
        return true
      }
      case 'setFilter': {
        const n = findNode(op.nodeId)
        if (!n) return false
        if (n.type !== 'Filter') {
          return fail(
            'type',
            'TYPE_NOT_FILTER',
            p('nodeId'),
            `setFilter 只能用于 Filter 节点，「${n.id}」是 ${n.type}`,
          )
        }
        n.params = { ...n.params, filter: structuredClone(op.filter) }
        return true
      }
      case 'updateApp': {
        if (op.name !== undefined) def.name = op.name
        if (op.description !== undefined) def.description = op.description
        if (op.icon !== undefined) def.icon = op.icon
        return true
      }
      case 'addView': {
        const views = def.views ?? []
        if (views.some((v) => v.id === op.view.id)) {
          return fail(
            'reference',
            'REF_DUPLICATE_ID',
            p('view', 'id'),
            `分享页「${op.view.id}」已存在`,
            '换一个新的视图 id，或用 updateView 修改已有分享页',
          )
        }
        def.views = [...views, structuredClone(op.view)]
        return true
      }
      case 'updateView': {
        const v = findView(op.viewId)
        if (!v) return false
        const c = op.changes
        if (c.label !== undefined) v.label = c.label
        if (c.audience !== undefined) v.audience = c.audience
        if (c.description !== undefined) v.description = c.description
        if (c.restrictedFields !== undefined) {
          if (c.restrictedFields.length) v.restrictedFields = [...c.restrictedFields]
          else delete v.restrictedFields
        }
        return true
      }
      case 'removeView': {
        if (!findView(op.viewId)) return false
        def.views = (def.views ?? []).filter((v) => v.id !== op.viewId)
        if (!def.views.length) delete def.views
        const gone = new Set(def.nodes.filter((n) => n.view === op.viewId).map((n) => n.id))
        if (gone.size) {
          def.nodes = def.nodes.filter((n) => !gone.has(n.id))
          const cut = def.bindings.filter((b) => gone.has(b.from.node) || gone.has(b.to.node))
          def.bindings = def.bindings.filter((b) => !cut.includes(b))
          notes.push({
            opIndex: i,
            kind: 'cascadeRemoveViewNodes',
            message: `移除分享页「${op.viewId}」同时移除了它的 ${gone.size} 个组件${cut.length ? `与 ${cut.length} 条绑定` : ''}：${[...gone].join('、')}`,
          })
        }
        return true
      }
    }
  }
  for (const [i, op] of ops.entries()) applyOne(op, i)

  return issues.length ? { ok: false, issues } : { ok: true, definition: def, notes }
}
