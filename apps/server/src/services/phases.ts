import {
  type AppPhase,
  computeDiff,
  constraintIssues,
  type PhaseInput,
  REGISTRY,
  validateProposal,
} from '@morphos/shared'
import { type Ctx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'
import { getApp } from './apps'
import { activeConstraints } from './constraints'
import { saveProposal } from './proposals'

export function listPhases(ctx: Ctx, appId: string): AppPhase[] {
  getApp(ctx, appId)
  const rows = ctx.db
    .prepare('SELECT * FROM app_phases WHERE app_id = ? AND revoked_at IS NULL ORDER BY created_at, rowid')
    .all(appId) as unknown as { id: string; name: string; visibility_json: string; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibility: JSON.parse(r.visibility_json) as AppPhase['visibility'],
    createdAt: r.created_at,
  }))
}

export function savePhase(ctx: Ctx, appId: string, input: PhaseInput) {
  return tx(ctx.db, () => {
    const app = getApp(ctx, appId)
    if (app.version !== input.baseVersion)
      throw new HttpError(409, 'VERSION_CONFLICT', '应用已变化，请刷新后重新配置阶段')
    if (listPhases(ctx, appId).length >= 12)
      throw new HttpError(422, 'PHASE_LIMIT', '最多保存 12 个阶段，请先移除不用的阶段')
    const nodes = app.definition.nodes.filter((n) => REGISTRY[n.type].visual)
    if (input.disabledNodes.some((id) => !nodes.some((n) => n.id === id)))
      throw new HttpError(422, 'PHASE_INVALID', '停用列表包含不存在的界面组件')
    const phase: AppPhase = {
      id: newId('phase'),
      name: input.name,
      visibility: nodes.map((n) => ({ nodeId: n.id, hidden: input.disabledNodes.includes(n.id) })),
      createdAt: ctx.now().toISOString(),
    }
    ctx.db
      .prepare(
        'INSERT INTO app_phases (id, app_id, name, visibility_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(phase.id, appId, phase.name, JSON.stringify(phase.visibility), phase.createdAt)
    audit(ctx.db, appId, 'phase.configured', phase, ctx.now())
    return phase
  })
}

export function proposePhase(ctx: Ctx, appId: string, phaseId: string) {
  const phase = listPhases(ctx, appId).find((p) => p.id === phaseId)
  if (!phase) throw notFound('业务阶段')
  const app = getApp(ctx, appId)
  const currentIds = new Set(app.definition.nodes.filter((n) => REGISTRY[n.type].visual).map((n) => n.id))
  if (currentIds.size !== phase.visibility.length || phase.visibility.some((v) => !currentIds.has(v.nodeId)))
    throw new HttpError(
      409,
      'PHASE_STALE',
      '组件已发生增减，请根据当前应用重新配置阶段，避免遗漏新的操作入口',
    )
  const operations = phase.visibility
    .filter((v) => Boolean(app.definition.nodes.find((n) => n.id === v.nodeId)?.hidden) !== v.hidden)
    .map((v) => ({ op: v.hidden ? 'hideNode' : 'showNode', nodeId: v.nodeId }))
  if (!operations.length) throw new HttpError(409, 'PHASE_ALREADY_ACTIVE', '当前组件启停状态已符合此阶段')
  const raw = {
    kind: 'patch',
    baseVersion: app.version,
    intent: `切换到业务阶段「${phase.name}」`,
    summary: `按已配置阶段调整 ${operations.length} 个组件的启停状态，业务记录保持不变`,
    operations,
  }
  const result = validateProposal(raw, { current: { definition: app.definition, version: app.version } })
  const issues = [
    ...result.issues,
    ...(result.after ? constraintIssues(result.after, activeConstraints(ctx, appId)) : []),
  ]
  if (!result.ok || !result.after || issues.some((i) => i.level === 'error'))
    throw new HttpError(
      409,
      'PHASE_CONFLICT',
      issues
        .filter((i) => i.level === 'error')
        .map((i) => i.message)
        .join('；'),
      issues,
    )
  return saveProposal(ctx, {
    appId,
    baseVersion: app.version,
    kind: 'patch',
    origin: 'manual',
    intent: raw.intent,
    proposal: raw,
    status: 'pending',
    issues,
    after: result.after,
    diff: computeDiff(app.definition, result.after, {
      fromVersion: app.version,
      recordCount: app.recordCount,
    }),
    trace: {
      origin: 'manual',
      model: '人工配置',
      promptVersion: 'phase-v1',
      temperature: null,
      context: `阶段配置 ${phase.id}`,
      rounds: [],
      totalMs: 0,
      notes: ['人工配置的阶段切换；仅生成待批准提案，不会自动执行。'],
    },
  })
}

export function removePhase(ctx: Ctx, appId: string, phaseId: string) {
  tx(ctx.db, () => {
    getApp(ctx, appId)
    const exists = ctx.db.prepare('SELECT id FROM app_phases WHERE app_id = ? AND id = ?').get(appId, phaseId)
    if (!exists) throw notFound('业务阶段')
    const r = ctx.db
      .prepare('UPDATE app_phases SET revoked_at = ? WHERE app_id = ? AND id = ? AND revoked_at IS NULL')
      .run(ctx.now().toISOString(), appId, phaseId)
    if (r.changes) audit(ctx.db, appId, 'phase.removed', { phaseId }, ctx.now())
  })
}
