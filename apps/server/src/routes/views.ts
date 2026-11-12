/**
 * Share links. Admin side: /apps/:id/views…, /share-info (local only, ADR-0008).
 * Share side: /v/:token… — reachable from any device; everything goes through services/views (protocol §11.4).
 */
import { z } from '@morphos/shared'
import { type RequestHandler, Router } from 'express'
import type { Ctx } from '../context'
import { badRequest } from '../errors'
import {
  actViaView,
  ensureLink,
  exportViaView,
  getViewSnapshot,
  listViewLinks,
  outboxViaView,
  resetLink,
  shareInfo,
  submitViaView,
} from '../services/views'
import { parseBody, sendCsv, ValuesSchema } from './util'

const Submit = z.object({ nodeId: z.string(), values: ValuesSchema })
const Action = z.object({ recordId: z.string(), answers: ValuesSchema.default({}) })
const Outbox = z.object({ nodeId: z.string() })

/** Share pages carry personal data: never cache them anywhere. */
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

export function viewsRouter(ctx: Ctx): Router {
  const r = Router()

  r.get('/apps/:id/views', (req, res) => {
    res.json({ views: listViewLinks(ctx, req.params.id) })
  })

  r.post('/apps/:id/views/:viewId/link', (req, res) => {
    res.json({ token: ensureLink(ctx, req.params.id, req.params.viewId) })
  })

  r.post('/apps/:id/views/:viewId/link/reset', (req, res) => {
    res.json({ token: resetLink(ctx, req.params.id, req.params.viewId) })
  })

  r.get('/share-info', (_req, res) => {
    res.json(shareInfo(ctx))
  })

  r.use('/v/:token', noStore)

  r.get('/v/:token', (req, res) => {
    res.json({ snapshot: getViewSnapshot(ctx, req.params.token) })
  })

  r.post('/v/:token/records', (req, res) => {
    const body = parseBody(Submit, req)
    res.status(201).json({ record: submitViaView(ctx, req.params.token, body.nodeId, body.values) })
  })

  r.post('/v/:token/actions/:nodeId', (req, res) => {
    const body = parseBody(Action, req)
    res.json({ record: actViaView(ctx, req.params.token, req.params.nodeId, body.recordId, body.answers) })
  })

  r.post('/v/:token/outbox', (req, res) => {
    const body = parseBody(Outbox, req)
    res.status(201).json({ entry: outboxViaView(ctx, req.params.token, body.nodeId) })
  })

  r.get('/v/:token/export.csv', (req, res) => {
    const node = typeof req.query.node === 'string' ? req.query.node : ''
    if (!node) throw badRequest('缺少 node 参数')
    sendCsv(res, exportViaView(ctx, req.params.token, node))
  })

  return r
}
