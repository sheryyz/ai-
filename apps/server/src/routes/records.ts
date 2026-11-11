import { z } from '@morphos/shared'
import { Router } from 'express'
import type { Ctx } from '../context'
import { badRequest } from '../errors'
import { getApp } from '../services/apps'
import {
  createRecord,
  deleteRecord,
  exportCsv,
  listOutbox,
  listStored,
  recordOutbox,
  runQuickAction,
  updateRecord,
} from '../services/records'
import { parseBody, ValuesSchema } from './util'

const Create = z.object({ nodeId: z.string(), values: ValuesSchema })
const Update = z.object({ nodeId: z.string(), values: ValuesSchema })
const Action = z.object({ recordId: z.string(), answers: ValuesSchema.default({}) })
const Outbox = z.object({ nodeId: z.string() })

export function recordsRouter(ctx: Ctx): Router {
  const r = Router()

  /** Raw stored records: clients materialize them against the current *or a proposed* definition. */
  r.get('/apps/:id/records', (req, res) => {
    getApp(ctx, req.params.id)
    res.json({ records: listStored(ctx, req.params.id) })
  })

  r.post('/apps/:id/records', (req, res) => {
    const body = parseBody(Create, req)
    res.status(201).json({ record: createRecord(ctx, req.params.id, body.nodeId, body.values) })
  })

  r.patch('/apps/:id/records/:rid', (req, res) => {
    const body = parseBody(Update, req)
    res.json({ record: updateRecord(ctx, req.params.id, body.nodeId, req.params.rid, body.values) })
  })

  r.delete('/apps/:id/records/:rid', (req, res) => {
    const node = typeof req.query.node === 'string' ? req.query.node : ''
    if (!node) throw badRequest('缺少 node 参数')
    deleteRecord(ctx, req.params.id, node, req.params.rid)
    res.status(204).end()
  })

  r.post('/apps/:id/actions/:nodeId', (req, res) => {
    const body = parseBody(Action, req)
    res.json({ record: runQuickAction(ctx, req.params.id, req.params.nodeId, body.recordId, body.answers) })
  })

  r.get('/apps/:id/export.csv', (req, res) => {
    const node = typeof req.query.node === 'string' ? req.query.node : ''
    if (!node) throw badRequest('缺少 node 参数')
    const { filename, csv, count } = exportCsv(ctx, req.params.id, node)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    res.setHeader('X-Record-Count', String(count))
    res.send(csv)
  })

  r.get('/apps/:id/outbox', (req, res) => {
    getApp(ctx, req.params.id)
    res.json({ outbox: listOutbox(ctx, req.params.id) })
  })

  r.post('/apps/:id/outbox', (req, res) => {
    const body = parseBody(Outbox, req)
    res.status(201).json({ entry: recordOutbox(ctx, req.params.id, body.nodeId) })
  })

  return r
}
