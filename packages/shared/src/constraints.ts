/** Human-confirmed rules live outside AppDefinition: AI patches and restores cannot remove them. */
import { stableStringify } from './diff'
import { computeExposure, viewNodes } from './exposure'
import { type FilterExpr, FilterExprSchema, isFilterGroup } from './filter'
import { SlugSchema } from './ids'
import { issue, type ValidationIssue } from './issues'
import { recordScope } from './runtime'
import type { AppDefinition } from './schema'
import { z } from './zod'

export const BusinessRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('submitOnly'), viewId: SlugSchema }).strict(),
  z
    .object({ kind: z.literal('allowedWrites'), viewId: SlugSchema, fields: z.array(SlugSchema).max(30) })
    .strict(),
  z.object({ kind: z.literal('messageScope'), nodeId: SlugSchema, condition: FilterExprSchema }).strict(),
])
export type BusinessRule = z.infer<typeof BusinessRuleSchema>
export const ConstraintSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1).max(120),
  rule: BusinessRuleSchema,
  createdAt: z.string(),
})
export type BusinessConstraint = z.infer<typeof ConstraintSchema>

/** Conservative proof: retain the confirmed predicate (possibly nested), or further narrow it.
 * We deliberately do not infer numerical equivalence or prove safety from today's sample records. */
export function scopeImplies(source: FilterExpr, target: FilterExpr): boolean {
  if (stableStringify(source) === stableStringify(target)) return true
  if (isFilterGroup(target) && target.op === 'and')
    return target.conditions.every((c) => scopeImplies(source, c))
  if (isFilterGroup(source))
    return source.op === 'and'
      ? source.conditions.some((c) => scopeImplies(c, target))
      : source.conditions.every((c) => scopeImplies(c, target))
  return false
}

export function constraintIssues(
  def: AppDefinition,
  constraints: Pick<BusinessConstraint, 'id' | 'label' | 'rule'>[],
): ValidationIssue[] {
  return constraints.flatMap(({ id, label, rule }) => {
    let reason = ''
    if (rule.kind === 'messageScope') {
      const node = def.nodes.find((n) => n.id === rule.nodeId)
      const scope = recordScope(def, rule.nodeId)
      if (!node || node.hidden || node.type !== 'MessageDraft') reason = '受保护的提醒组件必须保留且可见'
      else if (!scope.length || !scopeImplies({ op: 'and', conditions: scope }, rule.condition))
        reason = '提醒对象必须保留已确认的筛选条件，允许在此基础上进一步筛选'
    } else {
      const exposure = computeExposure(def, rule.viewId)
      if (!exposure?.nodes.length) reason = '受保护的角色页面必须保留且可用'
      else if (rule.kind === 'submitOnly') {
        if (viewNodes(def, rule.viewId).some((n) => n.type !== 'Form'))
          reason = '此页面只能包含提交表单，不能读取名单、统计或执行修改'
      } else if (exposure.canCreate || exposure.write.some((f) => !rule.fields.includes(f))) {
        reason = '此页面只能修改已允许的字段，不能新增记录或写入其他字段'
      }
    }
    return reason
      ? [
          issue(
            'safety',
            'BUSINESS_CONSTRAINT',
            `constraints.${id}`,
            `「${label}」：${reason}`,
            '请调整提案以遵守规则；规则只能由管理者在“约束”面板明确解除，AI 和恢复版本均不能绕过。',
          ),
        ]
      : []
  })
}
