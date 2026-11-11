/**
 * protocol.md §6–§7 — proposal validation across all six layers.
 * Input is untrusted model output (already JSON-parsed). Nothing here has side effects.
 */
import { hasErrors, issue, joinPath, sortIssues, type ValidationIssue, zodIssues } from './issues'
import { type ApplyNote, applyPatch } from './patch'
import {
  type AppDefinition,
  FORBIDDEN_OP_NAMES,
  PATCH_OP_NAMES,
  type PatchOp,
  PatchOpSchema,
  type Proposal,
  ProposalEnvelopeSchema,
} from './schema'
import { validateDefinition } from './validate'

export interface ProposalContext {
  /** Current app state; required for patch proposals. */
  current?: { definition: AppDefinition; version: number }
}

export interface ProposalValidation {
  ok: boolean
  issues: ValidationIssue[]
  /** Parsed proposal with normalized definition / operations (present when the envelope parsed). */
  proposal?: Proposal
  before: AppDefinition | null
  /** Resulting definition if the proposal were approved. */
  after?: AppDefinition
  notes: ApplyNote[]
}

const FORBIDDEN_HINTS: Record<string, string> = {
  data: '界面变更协议不允许删除或清空业务记录。若只是不想看到这些记录，可新增 Filter 节点筛掉它们，或用 hideNode 隐藏相关组件；记录本身会被完整保留。',
  entity: '不允许删除数据实体。可用 hideNode 隐藏不需要的组件。',
  field:
    '不支持删除字段（旧数据会失去含义）。可把该字段从 Table.columns / Form.fields 中移除，使其不再显示。',
  fieldType:
    '不支持修改字段类型或标识符。可用 addField 新增一个字段，或用 updateField 只修改显示名称 label。',
  code: 'AI 只能输出协议定义的结构化操作，系统不会执行任何代码、SQL 或脚本。',
}

const FORBIDDEN_KIND: Record<(typeof FORBIDDEN_OP_NAMES)[number], keyof typeof FORBIDDEN_HINTS> = {
  deleteRecords: 'data',
  deleteRecord: 'data',
  clearData: 'data',
  resetData: 'data',
  truncate: 'data',
  dropEntity: 'entity',
  dropCollection: 'entity',
  dropTable: 'entity',
  removeField: 'field',
  deleteField: 'field',
  changeFieldType: 'fieldType',
  renameFieldId: 'fieldType',
  rawSQL: 'code',
  rawCode: 'code',
  executeScript: 'code',
  eval: 'code',
  runShell: 'code',
}

/** Keys inside updateField.changes that would be destructive if honoured. */
const DESTRUCTIVE_CHANGE_KEYS: Record<string, string> = {
  type: '不支持修改字段类型',
  id: '不支持修改字段标识符',
  options: '不支持整体替换单选选项（可能删除已有选项）',
  removeOptions: '不支持删除单选选项（已有记录可能正在使用）',
  required: '不支持修改字段的必填属性',
}

export function validateProposal(raw: unknown, ctx: ProposalContext = {}): ProposalValidation {
  const before = ctx.current?.definition ?? null
  const env = ProposalEnvelopeSchema.safeParse(raw)
  if (!env.success) return { ok: false, issues: sortIssues(zodIssues(env.error, [])), before, notes: [] }
  const p = env.data

  if (p.kind === 'refusal') return { ok: true, issues: [], proposal: p, before, notes: [] }

  if (p.kind === 'create') {
    const r = validateDefinition(p.definition)
    const issues = r.issues.map((x) => ({ ...x, path: joinPath('definition', x.path) }))
    return {
      ok: r.ok,
      issues,
      proposal: r.definition ? { ...p, definition: r.definition } : undefined,
      before: null,
      after: r.definition,
      notes: [],
    }
  }

  // ── patch ─────────────────────────────────────────────────────────────────
  const issues: ValidationIssue[] = []
  if (!ctx.current) {
    return {
      ok: false,
      issues: [issue('version', 'VERSION_NO_BASE', 'baseVersion', '增量变更需要一个已存在的应用')],
      before,
      notes: [],
    }
  }
  if (p.baseVersion !== ctx.current.version) {
    issues.push(
      issue(
        'version',
        'VERSION_CONFLICT',
        'baseVersion',
        `提案基于版本 v${p.baseVersion}，但应用当前是 v${ctx.current.version}`,
        '应用已被修改，请基于最新版本重新规划',
      ),
    )
  }

  const ops: PatchOp[] = []
  p.operations.forEach((rawOp, i) => {
    const name = typeof rawOp === 'object' && rawOp !== null ? (rawOp as { op?: unknown }).op : undefined
    if (typeof name !== 'string') {
      issues.push(issue('schema', 'SCHEMA_INVALID', ['operations', i, 'op'], `operations[${i}] 缺少 op 字段`))
      return
    }
    if ((FORBIDDEN_OP_NAMES as readonly string[]).includes(name)) {
      const kind = FORBIDDEN_KIND[name as (typeof FORBIDDEN_OP_NAMES)[number]]
      issues.push(
        issue(
          'safety',
          'SAFETY_FORBIDDEN_OP',
          ['operations', i, 'op'],
          `操作 ${name} 被禁止：${kind === 'code' ? '不能执行代码' : '会破坏已有业务数据或结构'}`,
          FORBIDDEN_HINTS[kind],
        ),
      )
      return
    }
    if (!(PATCH_OP_NAMES as readonly string[]).includes(name)) {
      issues.push(
        issue(
          'schema',
          'SCHEMA_UNKNOWN_OP',
          ['operations', i, 'op'],
          `未知操作 ${name}`,
          `允许的操作：${PATCH_OP_NAMES.join(' / ')}`,
        ),
      )
      return
    }
    if (name === 'updateField') {
      const changes = (rawOp as { changes?: unknown }).changes
      const destructive =
        typeof changes === 'object' && changes !== null
          ? Object.keys(changes).filter((key) => key in DESTRUCTIVE_CHANGE_KEYS)
          : []
      for (const key of destructive) {
        issues.push(
          issue(
            'safety',
            'SAFETY_DESTRUCTIVE_SCHEMA',
            ['operations', i, 'changes', key],
            DESTRUCTIVE_CHANGE_KEYS[key] ?? key,
            FORBIDDEN_HINTS.fieldType,
          ),
        )
      }
      // Already rejected by the safety layer; a structural error on the same keys would only add noise.
      if (destructive.length) return
    }
    const parsed = PatchOpSchema.safeParse(rawOp)
    if (parsed.success) ops.push(parsed.data)
    else issues.push(...zodIssues(parsed.error, ['operations', i]))
  })

  if (hasErrors(issues)) return { ok: false, issues: sortIssues(issues), before, notes: [] }

  const applied = applyPatch(ctx.current.definition, ops)
  if (!applied.ok) return { ok: false, issues: sortIssues([...issues, ...applied.issues]), before, notes: [] }

  const result = validateDefinition(applied.definition)
  issues.push(...result.issues.map((x) => ({ ...x, path: joinPath('result', x.path) })))

  // Defense in depth: whatever the ops were, the resulting schema must not lose fields, types or options.
  if (result.definition) issues.push(...destructiveSchemaIssues(ctx.current.definition, result.definition))

  const sorted = sortIssues(issues)
  return {
    ok: !hasErrors(sorted),
    issues: sorted,
    proposal: { ...p, operations: ops },
    before,
    after: result.definition,
    notes: applied.notes,
  }
}

export function destructiveSchemaIssues(before: AppDefinition, after: AppDefinition): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const be of before.entities) {
    const ae = after.entities.find((e) => e.id === be.id)
    if (!ae) {
      out.push(issue('safety', 'SAFETY_DESTRUCTIVE_SCHEMA', 'result.entities', `实体「${be.label}」被移除`))
      continue
    }
    for (const bf of be.fields) {
      const af = ae.fields.find((f) => f.id === bf.id)
      if (!af) {
        out.push(
          issue(
            'safety',
            'SAFETY_DESTRUCTIVE_SCHEMA',
            'result.entities',
            `字段「${bf.label}」被移除`,
            FORBIDDEN_HINTS.field,
          ),
        )
      } else if (af.type !== bf.type) {
        out.push(
          issue(
            'safety',
            'SAFETY_DESTRUCTIVE_SCHEMA',
            'result.entities',
            `字段「${bf.label}」的类型被修改`,
            FORBIDDEN_HINTS.fieldType,
          ),
        )
      } else {
        const lost = (bf.options ?? []).filter((o) => !(af.options ?? []).includes(o))
        if (lost.length) {
          out.push(
            issue(
              'safety',
              'SAFETY_DESTRUCTIVE_SCHEMA',
              'result.entities',
              `字段「${bf.label}」的选项被删除：${lost.join('、')}`,
            ),
          )
        }
      }
    }
  }
  return out
}
