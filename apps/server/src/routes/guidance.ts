import { PhaseInputSchema, ResolveIntentSchema, z } from '@morphos/shared'
import { Router } from 'express'
import type { Ctx } from '../context'
import { tx } from '../db'
import { HttpError } from '../errors'
import { LlmError } from '../llm/client'
import { generateOptions, getBrief, prepareIntent } from '../services/guidance'
import { previewProposal } from '../services/impact'
import { listPhases, proposePhase, removePhase, savePhase } from '../services/phases'
import { getProposal } from '../services/proposals'
import { parseBody } from './util'

export function guidanceRouter(ctx: Ctx) {
  const r = Router()
  r.post('/ai/prepare', async (req, res) => {
    const body = parseBody(
      z
        .object({
          intent: z.string().trim().min(2).max(500),
          appId: z.string().optional(),
          parentId: z.string().optional(),
        })
        .strict(),
      req,
    )
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    try {
      res.json({ prepared: await prepareIntent(ctx, body, abort.signal) })
    } catch (e) {
      if (e instanceof LlmError) throw new HttpError(503, e.code, e.message)
      throw e
    }
  })
  r.get('/intent-briefs/:id', (req, res) => res.json({ prepared: getBrief(ctx, req.params.id) }))
  r.post('/ai/options', async (req, res) => {
    const body = parseBody(ResolveIntentSchema, req)
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    res.json(await generateOptions(ctx, body, abort.signal))
  })
  r.get('/proposal-groups/:id', (req, res) => {
    getBrief(ctx, req.params.id)
    const at = ctx.now()
    const snapshotCtx = { ...ctx, now: () => at }
    const options = tx(ctx.db, () => {
      const ids = ctx.db
        .prepare('SELECT id FROM proposals WHERE group_id = ? ORDER BY rowid')
        .all(req.params.id) as { id: string }[]
      return ids.map(({ id }) => {
        const proposal = getProposal(ctx, id)
        try {
          return {
            proposal,
            preview: proposal.status === 'pending' ? previewProposal(snapshotCtx, id) : null,
            error: null,
          }
        } catch (e) {
          return { proposal, preview: null, error: e instanceof Error ? e.message : '预演不可用' }
        }
      })
    })
    res.setHeader('Cache-Control', 'no-store').json({ options, computedAt: at.toISOString() })
  })
  r.get('/apps/:id/phases', (req, res) => res.json({ phases: listPhases(ctx, req.params.id) }))
  r.post('/apps/:id/phases', (req, res) =>
    res.status(201).json({ phase: savePhase(ctx, req.params.id, parseBody(PhaseInputSchema, req)) }),
  )
  r.post('/apps/:id/phases/:phase/propose', (req, res) =>
    res.json({ proposal: proposePhase(ctx, req.params.id, req.params.phase) }),
  )
  r.delete('/apps/:id/phases/:phase', (req, res) => {
    removePhase(ctx, req.params.id, req.params.phase)
    res.status(204).end()
  })
  return r
}
