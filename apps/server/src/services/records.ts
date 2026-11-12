/**
 * Business records (generic JSON storage, ADR-0002). Every write is validated against the *current* schema
 * and must be backed by a visible component that grants the capability — the AI cannot reach this module.
 */
import {
  type AppDefinition,
  asRows,
  defaultColumns,
  evaluateFilter,
  evaluateGraph,
  fieldTypesOf,
  materialize,
  type NodeDef,
  type OutboxEntry,
  type ParamsOf,
  primaryEntity,
  type Row,
  renderTemplate,
  resolveSet,
  type StoredRecord,
  toCSV,
  validateRecordInput,
} from '@morphos/shared'
import { type Ctx, evalCtx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'
import { getApp } from './apps'

interface RecordRow {
  id: string
  data_json: string
  created_at: string
  updated_at: string
}

const toStored = (r: RecordRow): StoredRecord => ({
  id: r.id,
  data: JSON.parse(r.data_json) as Record<string, unknown>,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listStored(ctx: Ctx, appId: string): StoredRecord[] {
  const rows = ctx.db
    .prepare(
      'SELECT id, data_json, created_at, updated_at FROM records WHERE app_id = ? AND deleted_at IS NULL ORDER BY created_at, id',
    )
    .all(appId) as unknown as RecordRow[]
  return rows.map(toStored)
}

export function listRows(ctx: Ctx, appId: string, def: AppDefinition): Row[] {
  const entity = primaryEntity(def)
  return listStored(ctx, appId).map((r) => materialize(r, entity))
}

function getStored(ctx: Ctx, appId: string, recordId: string): StoredRecord {
  const r = ctx.db
    .prepare(
      'SELECT id, data_json, created_at, updated_at FROM records WHERE id = ? AND app_id = ? AND deleted_at IS NULL',
    )
    .get(recordId, appId) as RecordRow | undefined
  if (!r) throw notFound('记录')
  return toStored(r)
}

function visibleNode<T extends NodeDef['type']>(
  def: AppDefinition,
  nodeId: string,
  type: T,
): NodeDef & { type: T } {
  const n = def.nodes.find((x) => x.id === nodeId)
  if (!n || n.type !== type) throw new HttpError(404, 'NODE_NOT_FOUND', `组件「${nodeId}」不存在或类型不符`)
  if (n.hidden)
    throw new HttpError(403, 'NODE_HIDDEN', `组件「${n.title ?? nodeId}」当前已隐藏，不能执行操作`)
  return n as NodeDef & { type: T }
}

function invalid(errors: { field: string; message: string }[]): HttpError {
  return new HttpError(422, 'RECORD_INVALID', errors.map((e) => e.message).join('；'), errors)
}

const today = evalCtx

/** Form submission: only the fields the form exposes are accepted. */
export function createRecord(
  ctx: Ctx,
  appId: string,
  formNodeId: string,
  input: Record<string, unknown>,
  auditDetail: object = {},
): Row {
  const app = getApp(ctx, appId)
  const form = visibleNode(app.definition, formNodeId, 'Form')
  const params = form.params as ParamsOf<'Form'>
  const extra = Object.keys(input).filter((k) => !params.fields.includes(k))
  if (extra.length) throw invalid(extra.map((f) => ({ field: f, message: `表单不包含字段「${f}」` })))
  const entity = primaryEntity(app.definition)
  const r = validateRecordInput(entity, input, 'create')
  if (!r.ok) throw invalid(r.errors)
  const id = newId('rec')
  const at = ctx.now().toISOString()
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        'INSERT INTO records (id, app_id, entity_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, appId, entity.id, JSON.stringify(r.values), at, at)
    audit(ctx.db, appId, 'record.created', { recordId: id, via: formNodeId, ...auditDetail }, ctx.now())
  })
  return materialize(getStored(ctx, appId, id), entity)
}

/** Bulk insert used only for template sample data. */
export function seedRecords(ctx: Ctx, appId: string, items: Record<string, unknown>[]): number {
  const app = getApp(ctx, appId)
  const entity = primaryEntity(app.definition)
  const base = ctx.now().getTime() - items.length * 60_000
  tx(ctx.db, () => {
    items.forEach((item, i) => {
      const r = validateRecordInput(entity, item, 'create')
      if (!r.ok) throw invalid(r.errors)
      const at = new Date(base + i * 60_000).toISOString()
      ctx.db
        .prepare(
          'INSERT INTO records (id, app_id, entity_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(newId('rec'), appId, entity.id, JSON.stringify(r.values), at, at)
    })
    audit(ctx.db, appId, 'record.seeded', { count: items.length }, ctx.now())
  })
  return items.length
}

/** Merges validated values into stored data, preserving keys unknown to the current version (ADR-0002). */
function writeUpdate(
  ctx: Ctx,
  appId: string,
  stored: StoredRecord,
  values: Record<string, unknown>,
  event: string,
  detail: object,
) {
  const merged = { ...stored.data, ...values }
  const at = ctx.now().toISOString()
  tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE records SET data_json = ?, updated_at = ? WHERE id = ? AND app_id = ?')
      .run(JSON.stringify(merged), at, stored.id, appId)
    audit(ctx.db, appId, event, { recordId: stored.id, fields: Object.keys(values), ...detail }, ctx.now())
  })
}

export function updateRecord(
  ctx: Ctx,
  appId: string,
  tableNodeId: string,
  recordId: string,
  input: Record<string, unknown>,
): Row {
  const app = getApp(ctx, appId)
  const table = visibleNode(app.definition, tableNodeId, 'Table')
  if (!(table.params as ParamsOf<'Table'>).editable) {
    throw new HttpError(403, 'NOT_EDITABLE', `「${table.title ?? tableNodeId}」不允许编辑`)
  }
  const entity = primaryEntity(app.definition)
  const stored = getStored(ctx, appId, recordId)
  const r = validateRecordInput(entity, input, 'update')
  if (!r.ok) throw invalid(r.errors)
  writeUpdate(ctx, appId, stored, r.values, 'record.updated', { via: tableNodeId })
  return materialize(getStored(ctx, appId, recordId), entity)
}

export function deleteRecord(ctx: Ctx, appId: string, tableNodeId: string, recordId: string): void {
  const app = getApp(ctx, appId)
  const table = visibleNode(app.definition, tableNodeId, 'Table')
  if (!(table.params as ParamsOf<'Table'>).allowDelete) {
    throw new HttpError(403, 'DELETE_NOT_ALLOWED', `「${table.title ?? tableNodeId}」未开启删除`)
  }
  getStored(ctx, appId, recordId)
  tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE records SET deleted_at = ? WHERE id = ? AND app_id = ?')
      .run(ctx.now().toISOString(), recordId, appId)
    audit(ctx.db, appId, 'record.deleted', { recordId, via: tableNodeId, soft: true }, ctx.now())
  })
}

/**
 * Executes a configured QuickAction on one record. The update is fully defined by the node's `set`
 * (plus the user's answers to `ask`), and only records currently flowing into the node and matching
 * `availableWhen` are eligible — the client cannot choose arbitrary fields to change.
 */
export function runQuickAction(
  ctx: Ctx,
  appId: string,
  nodeId: string,
  recordId: string,
  answers: Record<string, unknown>,
  auditDetail: object = {},
): Row {
  const app = getApp(ctx, appId)
  const node = visibleNode(app.definition, nodeId, 'QuickAction')
  const p = node.params as ParamsOf<'QuickAction'>
  const entity = primaryEntity(app.definition)
  const rows = listRows(ctx, appId, app.definition)
  const graph = evaluateGraph(app.definition, rows, today(ctx))
  const target = asRows(graph.get(nodeId)?.inputs.rows).find((r) => r.id === recordId)
  if (!target) throw new HttpError(404, 'RECORD_NOT_ELIGIBLE', '该记录不在此操作的范围内')
  if (p.availableWhen && !evaluateFilter(p.availableWhen, target, fieldTypesOf(entity), today(ctx))) {
    throw new HttpError(409, 'ACTION_NOT_AVAILABLE', `「${p.label}」不适用于这条记录（状态可能已变化）`)
  }
  const extra = Object.keys(answers).filter((k) => !(p.ask ?? []).includes(k))
  if (extra.length) throw invalid(extra.map((f) => ({ field: f, message: `此操作不需要填写「${f}」` })))
  const missing = (p.ask ?? []).filter((k) => answers[k] === undefined || answers[k] === '')
  if (missing.length)
    throw invalid(
      missing.map((f) => ({
        field: f,
        message: `请填写「${entity.fields.find((x) => x.id === f)?.label ?? f}」`,
      })),
    )
  const r = validateRecordInput(
    entity,
    resolveSet(p.set, answers as Record<string, never>, today(ctx)),
    'update',
  )
  if (!r.ok) throw invalid(r.errors)
  writeUpdate(ctx, appId, getStored(ctx, appId, recordId), r.values, 'quickaction.executed', {
    via: nodeId,
    ...auditDetail,
  })
  return materialize(getStored(ctx, appId, recordId), entity)
}

/** CSV of exactly the records flowing into a CSVExport (or Table) node — same evaluation as the UI. */
export function exportCsv(
  ctx: Ctx,
  appId: string,
  nodeId: string,
): { filename: string; csv: string; count: number } {
  const app = getApp(ctx, appId)
  const node = app.definition.nodes.find((n) => n.id === nodeId)
  if (!node || (node.type !== 'CSVExport' && node.type !== 'Table')) {
    throw new HttpError(404, 'NODE_NOT_FOUND', `导出组件「${nodeId}」不存在`)
  }
  const entity = primaryEntity(app.definition)
  const rows = asRows(
    evaluateGraph(app.definition, listRows(ctx, appId, app.definition), today(ctx)).get(nodeId)?.inputs.rows,
  )
  const columns =
    node.type === 'CSVExport'
      ? ((node.params as ParamsOf<'CSVExport'>).columns ?? defaultColumns(entity))
      : (node.params as ParamsOf<'Table'>).columns
  const filename =
    node.type === 'CSVExport' ? (node.params as ParamsOf<'CSVExport'>).filename : (node.title ?? app.name)
  return {
    filename: `${filename}.csv`,
    csv: toCSV(rows, columns, entity, ctx.config.timeZone),
    count: rows.length,
  }
}

// ── simulated outbox ─────────────────────────────────────────────────────────

/** Records drafts in the simulated outbox. Nothing is sent to any real SMS/IM channel. */
export function recordOutbox(ctx: Ctx, appId: string, nodeId: string, auditDetail: object = {}): OutboxEntry {
  const app = getApp(ctx, appId)
  const node = visibleNode(app.definition, nodeId, 'MessageDraft')
  const p = node.params as ParamsOf<'MessageDraft'>
  const entity = primaryEntity(app.definition)
  const rows = listRows(ctx, appId, app.definition)
  const recipients = asRows(evaluateGraph(app.definition, rows, today(ctx)).get(nodeId)?.inputs.recipients)
  if (!recipients.length) throw new HttpError(400, 'NO_RECIPIENTS', '当前没有收件人')
  const messages = recipients.map((r) => ({
    recordId: r.id,
    to: String(r.values[entity.displayField] ?? r.id),
    body: renderTemplate(p.template, r, entity, ctx.config.timeZone),
  }))
  const entry: OutboxEntry = {
    id: newId('msg'),
    nodeId,
    channel: p.channelLabel,
    recipientCount: messages.length,
    messages,
    createdAt: ctx.now().toISOString(),
  }
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        'INSERT INTO outbox (id, app_id, node_id, channel, messages_json, recipient_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(entry.id, appId, nodeId, entry.channel, JSON.stringify(messages), messages.length, entry.createdAt)
    audit(
      ctx.db,
      appId,
      'outbox.recorded',
      { outboxId: entry.id, recipients: messages.length, ...auditDetail },
      ctx.now(),
    )
  })
  return entry
}

export function listOutbox(ctx: Ctx, appId: string): OutboxEntry[] {
  const rows = ctx.db
    .prepare('SELECT * FROM outbox WHERE app_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(appId) as unknown as {
    id: string
    node_id: string
    channel: string
    messages_json: string
    recipient_count: number
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.node_id,
    channel: r.channel,
    recipientCount: r.recipient_count,
    messages: JSON.parse(r.messages_json),
    createdAt: r.created_at,
  }))
}
