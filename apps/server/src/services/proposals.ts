/**
 * Proposal lifecycle: pending → approved / rejected (or invalid / refused, terminal at creation).
 * Approval re-validates against the *current* app inside one transaction (architecture.md §2.1),
 * so a stale or tampered proposal can never become a version.
 */
import {
  type AppDefinition,
  computeDiff,
  type MorphDiff,
  type ProposalOrigin,
  type ProposalRecord,
  type ProposalStatus,
  type ProposalTrace,
  type ValidationIssue,
  validateProposal,
} from '@morphos/shared'
import { type Ctx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'
import { commitVersionUnsafe, createAppUnsafe, getApp } from './apps'
import { requireExposureConfirmation } from './exposure-confirm'

interface ProposalRow {
  id: string
  app_id: string | null
  base_version: number | null
  kind: 'create' | 'patch' | 'refusal'
  intent: string
  origin: ProposalOrigin
  proposal_json: string
  diff_json: string | null
  issues_json: string
  trace_json: string
  after_json: string | null
  status: ProposalStatus
  result_app_id: string | null
  result_version: number | null
  created_at: string
  decided_at: string | null
}

const toRecord = (r: ProposalRow): ProposalRecord => ({
  id: r.id,
  appId: r.app_id,
  baseVersion: r.base_version,
  kind: r.kind,
  intent: r.intent,
  origin: r.origin,
  status: r.status,
  proposal: JSON.parse(r.proposal_json),
  diff: r.diff_json ? (JSON.parse(r.diff_json) as MorphDiff) : null,
  issues: JSON.parse(r.issues_json) as ValidationIssue[],
  trace: JSON.parse(r.trace_json) as ProposalTrace,
  after: r.after_json ? (JSON.parse(r.after_json) as AppDefinition) : null,
  resultAppId: r.result_app_id,
  resultVersion: r.result_version,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
})

export interface NewProposal {
  appId: string | null
  baseVersion: number | null
  kind: 'create' | 'patch' | 'refusal'
  intent: string
  origin: ProposalOrigin
  status: ProposalStatus
  proposal: unknown
  diff: MorphDiff | null
  issues: ValidationIssue[]
  trace: ProposalTrace
  after: AppDefinition | null
}

export function saveProposal(ctx: Ctx, p: NewProposal): ProposalRecord {
  const id = newId('prop')
  const at = ctx.now().toISOString()
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO proposals (id, app_id, base_version, kind, intent, origin, proposal_json, diff_json, issues_json,
           trace_json, after_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        p.appId,
        p.baseVersion,
        p.kind,
        p.intent,
        p.origin,
        JSON.stringify(p.proposal ?? null),
        p.diff ? JSON.stringify(p.diff) : null,
        JSON.stringify(p.issues),
        JSON.stringify(p.trace),
        p.after ? JSON.stringify(p.after) : null,
        p.status,
        at,
      )
    audit(ctx.db, p.appId, 'proposal.created', { proposalId: id, kind: p.kind, status: p.status }, ctx.now())
  })
  return getProposal(ctx, id)
}

export function getProposal(ctx: Ctx, id: string): ProposalRecord {
  const r = ctx.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as ProposalRow | undefined
  if (!r) throw notFound('提案')
  return toRecord(r)
}

export function listProposals(ctx: Ctx, appId: string): ProposalRecord[] {
  getApp(ctx, appId)
  const rows = ctx.db
    .prepare('SELECT * FROM proposals WHERE app_id = ? ORDER BY created_at, rowid')
    .all(appId) as unknown as ProposalRow[]
  return rows.map(toRecord)
}

function assertPending(p: ProposalRecord) {
  if (p.status !== 'pending') {
    throw new HttpError(409, 'PROPOSAL_NOT_PENDING', `该提案状态为「${p.status}」，不能再次处理`)
  }
}

export function approveProposal(
  ctx: Ctx,
  id: string,
  opts: { confirmExposure?: boolean } = {},
): { proposal: ProposalRecord; appId: string; version: number } {
  return tx(ctx.db, () => {
    const p = getProposal(ctx, id)
    assertPending(p)
    const source = p.origin === 'recorded' ? 'recorded' : 'ai'
    const decidedAt = ctx.now().toISOString()

    if (p.kind === 'create') {
      const r = validateProposal(p.proposal)
      if (!r.ok || !r.after) throw new HttpError(422, 'PROPOSAL_INVALID', '提案未通过校验', r.issues)
      // protocol §11.5: recomputed from the definitions, never trusted from the stored diff.
      const diff = computeDiff(null, r.after, { fromVersion: 0, recordCount: 0 })
      const confirmed = requireExposureConfirmation(diff, r.after, opts.confirmExposure)
      const summary = p.diff?.summary ?? null
      const appId = createAppUnsafe(ctx, r.after, { source, intent: p.intent, summary, proposalId: p.id })
      if (confirmed)
        audit(
          ctx.db,
          appId,
          'exposure.confirmed',
          { proposalId: id, version: 1, views: confirmed },
          ctx.now(),
        )
      ctx.db
        .prepare(
          `UPDATE proposals SET status = 'approved', app_id = ?, result_app_id = ?, result_version = 1, decided_at = ? WHERE id = ?`,
        )
        .run(appId, appId, decidedAt, id)
      audit(ctx.db, appId, 'proposal.approved', { proposalId: id, version: 1 }, ctx.now())
      return { proposal: getProposal(ctx, id), appId, version: 1 }
    }

    if (p.kind === 'patch' && p.appId) {
      const app = getApp(ctx, p.appId)
      const r = validateProposal(p.proposal, {
        current: { definition: app.definition, version: app.version },
      })
      if (r.issues.some((i) => i.code === 'VERSION_CONFLICT')) {
        throw new HttpError(
          409,
          'VERSION_CONFLICT',
          `应用已更新到 v${app.version}，这个提案基于 v${p.baseVersion}，请重新规划`,
          r.issues,
        )
      }
      if (!r.ok || !r.after) throw new HttpError(422, 'PROPOSAL_INVALID', '提案未通过校验', r.issues)
      const diff = computeDiff(app.definition, r.after, {
        fromVersion: app.version,
        recordCount: app.recordCount,
      })
      const confirmed = requireExposureConfirmation(diff, r.after, opts.confirmExposure)
      const version = commitVersionUnsafe(ctx, p.appId, app.version, r.after, {
        source,
        intent: p.intent,
        summary: p.diff?.summary ?? null,
        proposalId: p.id,
      })
      ctx.db
        .prepare(
          `UPDATE proposals SET status = 'approved', result_app_id = ?, result_version = ?, decided_at = ? WHERE id = ?`,
        )
        .run(p.appId, version, decidedAt, id)
      audit(ctx.db, p.appId, 'proposal.approved', { proposalId: id, version }, ctx.now())
      if (confirmed)
        audit(ctx.db, p.appId, 'exposure.confirmed', { proposalId: id, version, views: confirmed }, ctx.now())
      return { proposal: getProposal(ctx, id), appId: p.appId, version }
    }

    throw new HttpError(409, 'PROPOSAL_NOT_APPROVABLE', '该提案不包含可批准的变更')
  })
}

export function rejectProposal(ctx: Ctx, id: string): ProposalRecord {
  return tx(ctx.db, () => {
    const p = getProposal(ctx, id)
    assertPending(p)
    ctx.db
      .prepare(`UPDATE proposals SET status = 'rejected', decided_at = ? WHERE id = ?`)
      .run(ctx.now().toISOString(), id)
    audit(ctx.db, p.appId, 'proposal.rejected', { proposalId: id }, ctx.now())
    return getProposal(ctx, id)
  })
}
