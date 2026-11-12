import { computeDiff, type PlanEvent, validateProposal, z } from '@morphos/shared'
import { Router } from 'express'
import type { Ctx } from '../context'
import { HttpError } from '../errors'
import type { LlmClient } from '../llm/client'
import { createReplayClient, getRecording, isApplicable, loadRecordings, recordingInfo } from '../llm/replay'
import { getApp } from '../services/apps'
import { runPlan } from '../services/planner'
import { approveProposal, getProposal, listProposals, rejectProposal } from '../services/proposals'
import { parseBody } from './util'

const PlanBody = z.union([
  z.object({ intent: z.string().trim().min(2).max(500), appId: z.string().optional() }),
  z.object({ recordingId: z.string(), appId: z.string().optional() }),
])

const Approve = z.object({ confirmExposure: z.boolean().optional() })

export function aiRouter(ctx: Ctx, deps: { replaySpeed?: number } = {}): Router {
  const r = Router()

  r.get('/recordings', (req, res) => {
    const appId = typeof req.query.appId === 'string' ? req.query.appId : undefined
    const current = appId ? getApp(ctx, appId).definition : null
    res.json({ recordings: loadRecordings().map((rec) => recordingInfo(rec, current)) })
  })

  /** Streams the pipeline as NDJSON (architecture.md §3). Errors before streaming use the normal JSON shape. */
  r.post('/ai/plan', async (req, res) => {
    const body = parseBody(PlanBody, req)
    const app = body.appId ? getApp(ctx, body.appId) : null

    let client: LlmClient
    let intent: string
    let rebaseFrom: number | undefined
    let recording: { id: string; recordedAt: string; model: string } | undefined
    if ('recordingId' in body) {
      const rec = getRecording(body.recordingId)
      if (!isApplicable(rec, app?.definition ?? null)) {
        throw new HttpError(
          409,
          'RECORDING_NOT_APPLICABLE',
          rec.kind === 'create'
            ? '这个演示样例用于创建新应用，请在应用中心使用'
            : '这个演示样例录制时的应用结构与当前应用不同，无法回放；请恢复到对应版本或使用实时 AI',
        )
      }
      client = createReplayClient(rec, { speed: deps.replaySpeed })
      intent = rec.intent
      rebaseFrom = rec.base?.version
      recording = { id: rec.id, recordedAt: rec.recordedAt, model: rec.model }
    } else {
      if (!ctx.llm) {
        throw new HttpError(
          503,
          'AI_UNAVAILABLE',
          '未配置模型 API（LLM_API_KEY），可以回放演示样例，或配置密钥后重试',
        )
      }
      client = ctx.llm
      intent = body.intent
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    const emit = (ev: PlanEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`)
    }
    try {
      await runPlan(ctx, client, { intent, appId: body.appId, rebaseFrom, recording }, emit, abort.signal)
    } catch (e) {
      console.error(e)
      emit({ type: 'error', code: 'INTERNAL_ERROR', message: '服务器内部错误，规划已中止' })
    }
    res.end()
  })

  r.get('/proposals/:id', (req, res) => {
    res.json({ proposal: getProposal(ctx, req.params.id) })
  })

  r.get('/apps/:id/proposals', (req, res) => {
    res.json({ proposals: listProposals(ctx, req.params.id) })
  })

  r.post('/proposals/:id/approve', (req, res) => {
    const body = parseBody(Approve, req)
    const result = approveProposal(ctx, req.params.id, body)
    res.json({ ...result, app: getApp(ctx, result.appId) })
  })

  r.post('/proposals/:id/reject', (req, res) => {
    res.json({ proposal: rejectProposal(ctx, req.params.id) })
  })

  /** Validates a hand-written Proposal JSON against the current app without storing anything. */
  r.post('/apps/:id/validate', (req, res) => {
    const app = getApp(ctx, req.params.id)
    const v = validateProposal(req.body, { current: { definition: app.definition, version: app.version } })
    const diff =
      v.ok && v.after && v.proposal?.kind !== 'refusal'
        ? computeDiff(app.definition, v.after, { fromVersion: app.version, recordCount: app.recordCount })
        : null
    res.json({ ok: v.ok, issues: v.issues, diff, notes: v.notes, recordCount: app.recordCount })
  })

  return r
}
