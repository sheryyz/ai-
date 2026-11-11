import { IconNameSchema, type PatchOp, z } from '@morphos/shared'
import { Router } from 'express'
import { type Ctx, evalCtx } from '../context'
import { HttpError } from '../errors'
import {
  applyManualPatch,
  createApp,
  getApp,
  getVersion,
  listApps,
  listVersions,
  previewRestore,
  restoreVersion,
} from '../services/apps'
import { seedRecords } from '../services/records'
import { getTemplate, listTemplates, resolveSamples } from '../services/templates'
import { intParam, parseBody } from './util'

const CreateFromTemplate = z.object({
  templateId: z.string(),
  withSampleData: z.boolean().default(false),
  name: z.string().trim().min(1).max(40).optional(),
})

const UpdateApp = z.object({
  baseVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
  icon: IconNameSchema.optional(),
})

const Restore = z.object({ baseVersion: z.number().int().min(1) })

export function appsRouter(ctx: Ctx): Router {
  const r = Router()

  r.get('/templates', (_req, res) => {
    res.json({ templates: listTemplates() })
  })

  r.get('/apps', (_req, res) => {
    res.json({ apps: listApps(ctx) })
  })

  r.post('/apps', (req, res) => {
    const body = parseBody(CreateFromTemplate, req)
    const t = getTemplate(body.templateId)
    const definition = body.name ? { ...t.info.definition, name: body.name } : t.info.definition
    const app = createApp(ctx, definition, {
      source: 'template',
      intent: `从模板「${t.info.name}」创建`,
      summary: `模板：${t.info.fieldCount} 个字段、${t.info.componentCount} 个组件`,
      hasSampleData: body.withSampleData,
    })
    if (body.withSampleData) seedRecords(ctx, app.id, resolveSamples(t.samples, evalCtx(ctx).today))
    res.status(201).json({ app: getApp(ctx, app.id) })
  })

  r.get('/apps/:id', (req, res) => {
    res.json({ app: getApp(ctx, req.params.id) })
  })

  r.patch('/apps/:id', (req, res) => {
    const body = parseBody(UpdateApp, req)
    const op: PatchOp = { op: 'updateApp', name: body.name, description: body.description, icon: body.icon }
    if (op.name === undefined && op.description === undefined && op.icon === undefined) {
      throw new HttpError(400, 'BAD_REQUEST', '没有需要修改的内容')
    }
    const result = applyManualPatch(ctx, req.params.id, body.baseVersion, [op], '修改应用信息')
    res.json({ ...result, app: getApp(ctx, req.params.id) })
  })

  r.get('/apps/:id/versions', (req, res) => {
    res.json({ versions: listVersions(ctx, req.params.id) })
  })

  r.get('/apps/:id/versions/:v', (req, res) => {
    res.json({ version: getVersion(ctx, req.params.id, intParam(req.params.v, 'version')) })
  })

  r.get('/apps/:id/versions/:v/diff', (req, res) => {
    res.json({ diff: previewRestore(ctx, req.params.id, intParam(req.params.v, 'version')) })
  })

  r.post('/apps/:id/versions/:v/restore', (req, res) => {
    const body = parseBody(Restore, req)
    const result = restoreVersion(ctx, req.params.id, intParam(req.params.v, 'version'), body.baseVersion)
    res.json({ ...result, app: getApp(ctx, req.params.id) })
  })

  return r
}
