import {
  type AppDefinition,
  type BusinessConstraint,
  type BusinessRule,
  constraintIssues,
  stableStringify,
} from '@morphos/shared'
import { type Ctx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'
import { getApp } from './apps'

/** Internal reader; public callers must first check that the app is accessible. */
export function activeConstraints(ctx: Ctx, appId: string): BusinessConstraint[] {
  const rows = ctx.db
    .prepare(
      'SELECT id, label, rule_json, created_at FROM app_constraints WHERE app_id = ? AND revoked_at IS NULL ORDER BY created_at, id',
    )
    .all(appId) as unknown as { id: string; label: string; rule_json: string; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    rule: JSON.parse(r.rule_json) as BusinessRule,
    createdAt: r.created_at,
  }))
}

export function assertConstraints(ctx: Ctx, appId: string, def: AppDefinition) {
  const issues = constraintIssues(def, activeConstraints(ctx, appId))
  if (issues.length)
    throw new HttpError(409, 'CONSTRAINT_CONFLICT', issues.map((i) => i.message).join('；'), issues)
}

export function addConstraint(
  ctx: Ctx,
  appId: string,
  baseVersion: number,
  label: string,
  rule: BusinessRule,
) {
  return tx(ctx.db, () => {
    const app = getApp(ctx, appId)
    if (app.version !== baseVersion)
      throw new HttpError(409, 'VERSION_CONFLICT', '应用已更新，请刷新后重新确认规则')
    const existing = activeConstraints(ctx, appId)
    const duplicate = existing.find((c) => stableStringify(c.rule) === stableStringify(rule))
    if (duplicate) return duplicate
    if (existing.length >= 20)
      throw new HttpError(422, 'CONSTRAINT_LIMIT', '每个应用最多保留 20 条有效约束，请先整理现有规则')
    const constraint: BusinessConstraint = {
      id: newId('rule'),
      label,
      rule,
      createdAt: ctx.now().toISOString(),
    }
    const issues = constraintIssues(app.definition, [constraint])
    if (issues.length)
      throw new HttpError(422, 'CONSTRAINT_INVALID', issues[0]?.message ?? '当前应用不满足此规则', issues)
    ctx.db
      .prepare(
        'INSERT INTO app_constraints (id, app_id, label, rule_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(constraint.id, appId, label, JSON.stringify(rule), constraint.createdAt)
    audit(ctx.db, appId, 'constraint.confirmed', constraint, ctx.now())
    return constraint
  })
}

export function revokeConstraint(ctx: Ctx, appId: string, id: string) {
  tx(ctx.db, () => {
    getApp(ctx, appId)
    const row = ctx.db
      .prepare('SELECT revoked_at FROM app_constraints WHERE app_id = ? AND id = ?')
      .get(appId, id) as { revoked_at: string | null } | undefined
    if (!row) throw notFound('约束')
    if (row.revoked_at) return
    ctx.db
      .prepare('UPDATE app_constraints SET revoked_at = ? WHERE app_id = ? AND id = ?')
      .run(ctx.now().toISOString(), appId, id)
    audit(ctx.db, appId, 'constraint.revoked', { id }, ctx.now())
  })
}
