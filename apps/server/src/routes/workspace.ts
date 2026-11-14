import express, { Router } from 'express'
import type { Ctx } from '../context'
import { HttpError } from '../errors'
import { backupBytes, restoreCopy } from '../services/backup'

/** Mounted behind both administrator guards. Uploaded bytes are never executed as SQL. */
export function workspaceRouter(ctx: Ctx) {
  const router = Router()
  router.post('/workspace/backup', (_req, res) => {
    const result = backupBytes(ctx)
    res.setHeader('Content-Disposition', `attachment; filename="${result.id}.db"`)
    res.type('application/octet-stream').send(result.content)
  })
  router.post(
    '/workspace/restore',
    express.raw({ type: 'application/octet-stream', limit: '50mb' }),
    (req, res) => {
      if (req.get('X-MorphOS-Restore') !== 'create-copy' || !Buffer.isBuffer(req.body))
        throw new HttpError(422, 'RESTORE_CONFIRM_REQUIRED', '请确认恢复为独立副本并选择备份文件')
      res.status(201).json(restoreCopy(ctx, req.body))
    },
  )
  return router
}
