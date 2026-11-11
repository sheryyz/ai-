/**
 * Apps and append-only versions (ADR-0002). Restoring creates a new version; records are never touched here.
 */
import {
  type AppDefinition,
  type AppDetail,
  type AppSummary,
  applyPatch,
  computeDiff,
  type MorphDiff,
  type PatchOp,
  type VersionInfo,
  type VersionSource,
  validateDefinition,
} from '@morphos/shared'
import { type Ctx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'

interface AppRow {
  id: string
  name: string
  icon: string
  current_version: number
  has_sample_data: number
  created_at: string
  updated_at: string
}
interface VersionRow {
  version: number
  definition_json: string
  source: VersionSource
  intent: string | null
  summary: string | null
  proposal_id: string | null
  restored_from: number | null
  created_at: string
}

export interface CommitMeta {
  source: VersionSource
  intent?: string | null
  summary?: string | null
  proposalId?: string | null
  restoredFrom?: number | null
}

function getAppRow(ctx: Ctx, id: string): AppRow {
  const row = ctx.db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined
  if (!row) throw notFound('应用')
  return row
}

function getVersionRow(ctx: Ctx, appId: string, version: number): VersionRow {
  const row = ctx.db
    .prepare('SELECT * FROM app_versions WHERE app_id = ? AND version = ?')
    .get(appId, version) as VersionRow | undefined
  if (!row) throw notFound(`版本 v${version} `)
  return row
}

export function recordCount(ctx: Ctx, appId: string): number {
  const r = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM records WHERE app_id = ? AND deleted_at IS NULL')
    .get(appId) as { n: number }
  return r.n
}

/** Re-validates before every write: storage only ever holds definitions that pass L1–L4. */
function assertValid(definition: AppDefinition): AppDefinition {
  const r = validateDefinition(definition)
  if (!r.ok || !r.definition) {
    throw new HttpError(422, 'DEFINITION_INVALID', '应用定义未通过校验', r.issues)
  }
  return r.definition
}

export function listApps(ctx: Ctx): AppSummary[] {
  const rows = ctx.db.prepare('SELECT * FROM apps ORDER BY updated_at DESC').all() as unknown as AppRow[]
  return rows.map((a) => {
    const v = getVersionRow(ctx, a.id, a.current_version)
    const def = JSON.parse(v.definition_json) as AppDefinition
    return {
      id: a.id,
      name: a.name,
      description: def.description ?? null,
      icon: a.icon,
      version: a.current_version,
      recordCount: recordCount(ctx, a.id),
      fieldCount: def.entities[0]?.fields.length ?? 0,
      componentCount: def.nodes.filter((n) => n.type !== 'CollectionSource').length,
      hasSampleData: a.has_sample_data === 1,
      lastChange: { source: v.source, intent: v.intent, summary: v.summary, at: v.created_at },
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }
  })
}

export function getApp(ctx: Ctx, id: string): AppDetail {
  const a = getAppRow(ctx, id)
  const v = getVersionRow(ctx, id, a.current_version)
  return {
    id: a.id,
    name: a.name,
    icon: a.icon,
    version: a.current_version,
    definition: JSON.parse(v.definition_json) as AppDefinition,
    hasSampleData: a.has_sample_data === 1,
    recordCount: recordCount(ctx, id),
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }
}

export function createApp(
  ctx: Ctx,
  definition: AppDefinition,
  meta: CommitMeta & { hasSampleData?: boolean },
): AppDetail {
  const def = assertValid(definition)
  const id = newId('app')
  const at = ctx.now().toISOString()
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        'INSERT INTO apps (id, name, icon, current_version, has_sample_data, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
      )
      .run(id, def.name, def.icon, meta.hasSampleData ? 1 : 0, at, at)
    insertVersion(ctx, id, 1, def, meta, at)
    audit(ctx.db, id, 'app.created', { source: meta.source, proposalId: meta.proposalId ?? null }, ctx.now())
  })
  return getApp(ctx, id)
}

function insertVersion(
  ctx: Ctx,
  appId: string,
  version: number,
  def: AppDefinition,
  meta: CommitMeta,
  at: string,
) {
  ctx.db
    .prepare(
      `INSERT INTO app_versions (app_id, version, definition_json, source, intent, summary, proposal_id, restored_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      appId,
      version,
      JSON.stringify(def),
      meta.source,
      meta.intent ?? null,
      meta.summary ?? null,
      meta.proposalId ?? null,
      meta.restoredFrom ?? null,
      at,
    )
}

/**
 * Compare-and-swap commit: fails with VERSION_CONFLICT if the app moved past baseVersion.
 * Must be called inside a transaction when combined with other writes (see commitVersionTx).
 */
export function commitVersionUnsafe(
  ctx: Ctx,
  appId: string,
  baseVersion: number,
  definition: AppDefinition,
  meta: CommitMeta,
): number {
  const def = assertValid(definition)
  const app = getAppRow(ctx, appId)
  if (app.current_version !== baseVersion) {
    throw new HttpError(
      409,
      'VERSION_CONFLICT',
      `应用已更新到 v${app.current_version}，请基于最新版本重新规划`,
      {
        baseVersion,
        currentVersion: app.current_version,
      },
    )
  }
  const next = baseVersion + 1
  const at = ctx.now().toISOString()
  insertVersion(ctx, appId, next, def, meta, at)
  ctx.db
    .prepare('UPDATE apps SET name = ?, icon = ?, current_version = ?, updated_at = ? WHERE id = ?')
    .run(def.name, def.icon, next, at, appId)
  audit(
    ctx.db,
    appId,
    meta.source === 'restore' ? 'version.restored' : 'version.committed',
    { version: next, ...meta },
    ctx.now(),
  )
  return next
}

export function commitVersion(
  ctx: Ctx,
  appId: string,
  baseVersion: number,
  definition: AppDefinition,
  meta: CommitMeta,
): number {
  return tx(ctx.db, () => commitVersionUnsafe(ctx, appId, baseVersion, definition, meta))
}

export function listVersions(ctx: Ctx, appId: string): VersionInfo[] {
  getAppRow(ctx, appId)
  const rows = ctx.db
    .prepare(
      'SELECT version, source, intent, summary, proposal_id, restored_from, created_at FROM app_versions WHERE app_id = ? ORDER BY version DESC',
    )
    .all(appId) as unknown as Omit<VersionRow, 'definition_json'>[]
  return rows.map((r) => ({
    version: r.version,
    source: r.source,
    intent: r.intent,
    summary: r.summary,
    proposalId: r.proposal_id,
    restoredFrom: r.restored_from,
    createdAt: r.created_at,
  }))
}

export function getVersion(
  ctx: Ctx,
  appId: string,
  version: number,
): VersionInfo & { definition: AppDefinition } {
  const r = getVersionRow(ctx, appId, version)
  return {
    version: r.version,
    source: r.source,
    intent: r.intent,
    summary: r.summary,
    proposalId: r.proposal_id,
    restoredFrom: r.restored_from,
    createdAt: r.created_at,
    definition: JSON.parse(r.definition_json) as AppDefinition,
  }
}

/** Diff between the current definition and another version, as a restore preview. */
export function previewRestore(ctx: Ctx, appId: string, version: number): MorphDiff {
  const app = getApp(ctx, appId)
  const target = getVersion(ctx, appId, version)
  return computeDiff(app.definition, target.definition, {
    fromVersion: app.version,
    recordCount: app.recordCount,
  })
}

/** Restores the UI configuration of `version` as a new version. Business records are not touched. */
export function restoreVersion(ctx: Ctx, appId: string, version: number, baseVersion: number) {
  const target = getVersion(ctx, appId, version)
  const app = getApp(ctx, appId)
  if (version === app.version) throw new HttpError(400, 'ALREADY_CURRENT', `v${version} 已是当前版本`)
  const diff = computeDiff(app.definition, target.definition, {
    fromVersion: app.version,
    recordCount: app.recordCount,
  })
  const newVersion = commitVersion(ctx, appId, baseVersion, target.definition, {
    source: 'restore',
    intent: `恢复到 v${version}`,
    summary: diff.summary,
    restoredFrom: version,
  })
  return { version: newVersion, diff }
}

/** Manual, non-AI edits (rename) go through the same patch + validation path as AI proposals. */
export function applyManualPatch(
  ctx: Ctx,
  appId: string,
  baseVersion: number,
  ops: PatchOp[],
  intent: string,
) {
  const app = getApp(ctx, appId)
  const r = applyPatch(app.definition, ops)
  if (!r.ok) throw new HttpError(422, 'PATCH_INVALID', '修改未通过校验', r.issues)
  const diff = computeDiff(app.definition, r.definition, {
    fromVersion: app.version,
    recordCount: app.recordCount,
  })
  const version = commitVersion(ctx, appId, baseVersion, r.definition, {
    source: 'manual',
    intent,
    summary: diff.summary,
  })
  return { version, diff }
}
