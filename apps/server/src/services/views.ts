/**
 * Role views and share links (protocol §11.4–11.5, ADR-0007). Tokens are credentials: generated here,
 * stored only in view_links, never logged, never put into definitions, prompts, proposals or audit details.
 * Everything a share page reads is evaluated and trimmed here (CLAUDE.md constraint 9).
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import {
  type AppDefinition,
  type AppDetail,
  computeExposure,
  type NodeDef,
  nodeExposure,
  primaryEntity,
  type Row,
  type ShareInfo,
  snapshotView,
  trimRow,
  type ViewDef,
  type ViewLinkInfo,
  type ViewSnapshot,
  viewNodes,
  viewsOf,
} from '@morphos/shared'
import { WEB_DIST } from '../config'
import { type Ctx, evalCtx } from '../context'
import { audit, tx } from '../db'
import { HttpError } from '../errors'
import { getApp } from './apps'
import { createRecord, exportCsv, listRows, recordOutbox, runQuickAction } from './records'

/** 144 random bits, URL-safe. */
export function newToken(): string {
  return randomBytes(18).toString('base64url')
}

function activeToken(ctx: Ctx, appId: string, viewId: string): string | null {
  const row = ctx.db
    .prepare('SELECT token FROM view_links WHERE app_id = ? AND view_id = ? AND revoked_at IS NULL')
    .get(appId, viewId) as { token: string } | undefined
  return row?.token ?? null
}

function requireView(def: AppDefinition, viewId: string): ViewDef {
  const v = viewsOf(def).find((x) => x.id === viewId)
  if (!v) throw new HttpError(404, 'VIEW_NOT_FOUND', `当前版本没有分享页「${viewId}」`)
  return v
}

export function listViewLinks(ctx: Ctx, appId: string): ViewLinkInfo[] {
  const def = getApp(ctx, appId).definition
  return viewsOf(def).map((v) => ({
    viewId: v.id,
    label: v.label,
    audience: v.audience,
    token: activeToken(ctx, appId, v.id),
    active: viewNodes(def, v.id).length > 0,
    // biome-ignore lint/style/noNonNullAssertion: the view exists in this definition
    exposure: computeExposure(def, v.id)!,
  }))
}

/** Returns the view's active token, creating one on first use. */
export function ensureLink(ctx: Ctx, appId: string, viewId: string): string {
  return tx(ctx.db, () => {
    requireView(getApp(ctx, appId).definition, viewId)
    const existing = activeToken(ctx, appId, viewId)
    if (existing) return existing
    const token = newToken()
    ctx.db
      .prepare('INSERT INTO view_links (token, app_id, view_id, created_at) VALUES (?, ?, ?, ?)')
      .run(token, appId, viewId, ctx.now().toISOString())
    audit(ctx.db, appId, 'view.link.created', { viewId }, ctx.now())
    return token
  })
}

/** Revokes the current token (old links stop working at once) and issues a new one. */
export function resetLink(ctx: Ctx, appId: string, viewId: string): string {
  return tx(ctx.db, () => {
    requireView(getApp(ctx, appId).definition, viewId)
    const at = ctx.now().toISOString()
    ctx.db
      .prepare('UPDATE view_links SET revoked_at = ? WHERE app_id = ? AND view_id = ? AND revoked_at IS NULL')
      .run(at, appId, viewId)
    const token = newToken()
    ctx.db
      .prepare('INSERT INTO view_links (token, app_id, view_id, created_at) VALUES (?, ?, ?, ?)')
      .run(token, appId, viewId, at)
    audit(ctx.db, appId, 'view.link.reset', { viewId }, ctx.now())
    return token
  })
}

interface Resolved {
  app: AppDetail
  view: ViewDef
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}$/

/** Token → current app and view. 404 for unknown / reset links, 410 when the view is gone or empty. */
export function resolveLink(ctx: Ctx, token: string): Resolved {
  const row = TOKEN_SHAPE.test(token)
    ? (ctx.db
        .prepare('SELECT app_id, view_id FROM view_links WHERE token = ? AND revoked_at IS NULL')
        .get(token) as { app_id: string; view_id: string } | undefined)
    : undefined
  if (!row) throw new HttpError(404, 'LINK_INVALID', '链接无效或已被组织者重置，请向组织者索取新链接')
  const app = getApp(ctx, row.app_id)
  const view = viewsOf(app.definition).find((v) => v.id === row.view_id)
  if (!view || viewNodes(app.definition, view.id).length === 0) {
    throw new HttpError(410, 'VIEW_INACTIVE', '此页面已停用，请联系组织者')
  }
  return { app, view }
}

export function getViewSnapshot(ctx: Ctx, token: string): ViewSnapshot {
  const { app, view } = resolveLink(ctx, token)
  const today = evalCtx(ctx)
  // biome-ignore lint/style/noNonNullAssertion: resolveLink guarantees the view exists
  const snap = snapshotView(app.definition, view.id, listRows(ctx, app.id, app.definition), today)!
  return {
    app: {
      name: app.definition.name,
      icon: app.definition.icon,
      description: app.definition.description ?? null,
    },
    view: { id: view.id, label: view.label, audience: view.audience, description: view.description ?? null },
    entity: snap.entity,
    nodes: snap.nodes,
    timeZone: ctx.config.timeZone,
    today: today.today,
  }
}

function viewNode(r: Resolved, nodeId: string, types: NodeDef['type'][]): NodeDef {
  const n = viewNodes(r.app.definition, r.view.id).find((x) => x.id === nodeId)
  if (!n || !types.includes(n.type)) throw new HttpError(404, 'NODE_NOT_IN_VIEW', '这个页面没有该组件')
  return n
}

const via = (r: Resolved) => ({ viaView: r.view.id })

/** Form submission through a share link. Returns only the new id, not the stored record. */
export function submitViaView(ctx: Ctx, token: string, nodeId: string, values: Record<string, unknown>) {
  const r = resolveLink(ctx, token)
  viewNode(r, nodeId, ['Form'])
  return { id: createRecord(ctx, r.app.id, nodeId, values, via(r)).id }
}

/** Quick action through a share link; the updated record comes back trimmed to what the node reads. */
export function actViaView(
  ctx: Ctx,
  token: string,
  nodeId: string,
  recordId: string,
  answers: Record<string, unknown>,
): Row {
  const r = resolveLink(ctx, token)
  const node = viewNode(r, nodeId, ['QuickAction'])
  const updated = runQuickAction(ctx, r.app.id, nodeId, recordId, answers, via(r))
  return trimRow(updated, nodeExposure(node, primaryEntity(r.app.definition)).read)
}

export function outboxViaView(ctx: Ctx, token: string, nodeId: string) {
  const r = resolveLink(ctx, token)
  viewNode(r, nodeId, ['MessageDraft'])
  return recordOutbox(ctx, r.app.id, nodeId, via(r))
}

/** CSV of a view's export or table node: its columns are exactly what the node reads. */
export function exportViaView(ctx: Ctx, token: string, nodeId: string) {
  const r = resolveLink(ctx, token)
  viewNode(r, nodeId, ['CSVExport', 'Table'])
  return exportCsv(ctx, r.app.id, nodeId)
}

export function shareInfo(ctx: Ctx): ShareInfo {
  const port = ctx.config.port
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a?.address}:${port}`)
  return {
    port,
    baseUrls: ctx.config.publicBaseUrl ? [ctx.config.publicBaseUrl] : lan,
    servesWeb: ctx.config.nodeEnv === 'production' && existsSync(WEB_DIST),
  }
}
