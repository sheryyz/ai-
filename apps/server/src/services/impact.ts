import { createHash } from 'node:crypto'
import { computeBusinessImpact, constraintIssues, stableStringify, validateProposal } from '@morphos/shared'
import { type Ctx, evalCtx } from '../context'
import { HttpError } from '../errors'
import { getApp } from './apps'
import { activeConstraints } from './constraints'
import { getProposal } from './proposals'
import { listStored } from './records'

export function previewProposal(ctx: Ctx, id: string) {
  const p = getProposal(ctx, id)
  if (p.status !== 'pending') throw new HttpError(409, 'PROPOSAL_NOT_PENDING', '此提案已处理，请查看当前应用')
  const app = p.appId ? getApp(ctx, p.appId) : null
  const result = validateProposal(
    p.proposal,
    app ? { current: { definition: app.definition, version: app.version } } : {},
  )
  if (!result.ok || !result.after)
    throw new HttpError(409, 'PREVIEW_UNAVAILABLE', '应用已变化，提案需重新规划', result.issues)
  const records = app ? listStored(ctx, app.id) : []
  const date = evalCtx(ctx)
  const rules = app ? activeConstraints(ctx, app.id) : []
  const token = createHash('sha256')
    .update(stableStringify({ id, version: app?.version, after: result.after, records, date, rules }))
    .digest('hex')
  return {
    impact: computeBusinessImpact(app?.definition ?? null, result.after, records, date),
    previewToken: token,
    computedAt: ctx.now().toISOString(),
    constraintIssues: constraintIssues(result.after, rules),
  }
}

export function requireFreshPreview(ctx: Ctx, id: string, token?: string) {
  if (token !== undefined && previewProposal(ctx, id).previewToken !== token) {
    throw new HttpError(409, 'IMPACT_PREVIEW_STALE', '数据已变化，请查看最新业务影响预演后重新批准')
  }
}
