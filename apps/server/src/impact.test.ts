import { describe, expect, it } from 'vitest'
import { checkinProposal, eventDef } from '../../../packages/shared/src/test-helpers'
import { createApp, getApp } from './services/apps'
import { runPlan } from './services/planner'
import { createRecord, listStored } from './services/records'
import { PEER_HEADER, scripted, testServer } from './test-utils'

describe('proposal preview freshness and isolation', () => {
  it('is read-only, checks real record changes inside approval and accepts a refreshed token', async () => {
    const { api, ctx } = testServer()
    const app = createApp(ctx, eventDef(), { source: 'manual' })
    createRecord(ctx, app.id, 'signup', { name: '甲', studentId: '1', major: '计算机' })
    const p = await runPlan(ctx, scripted([checkinProposal()]), { appId: app.id, intent: '加签到' }, () => {})
    expect(p?.status).toBe('pending')
    const before = JSON.stringify(listStored(ctx, app.id))
    const preview = await api().get(`/api/proposals/${p!.id}/preview`).expect(200)
    expect(preview.body.impact.recordCount).toBe(1)
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(before)
    expect(getApp(ctx, app.id).version).toBe(1)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(0)
    await api().get(`/api/proposals/${p!.id}/preview`).set(PEER_HEADER, '192.168.1.15').expect(403)

    createRecord(ctx, app.id, 'signup', { name: '乙', studentId: '2', major: '其他' })
    const failed = await api()
      .post(`/api/proposals/${p!.id}/approve`)
      .send({ previewToken: preview.body.previewToken })
      .expect(409)
    expect(failed.body.error.code).toBe('IMPACT_PREVIEW_STALE')
    expect(getApp(ctx, app.id).version).toBe(1)
    const fresh = await api().get(`/api/proposals/${p!.id}/preview`).expect(200)
    expect(fresh.body.impact.recordCount).toBe(2)
    expect(fresh.body.previewToken).not.toBe(preview.body.previewToken)
    const records = JSON.stringify(listStored(ctx, app.id))
    await api()
      .post(`/api/proposals/${p!.id}/approve`)
      .send({ previewToken: fresh.body.previewToken })
      .expect(200)
    expect(getApp(ctx, app.id).version).toBe(2)
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(records)
    await api().get(`/api/proposals/${p!.id}/preview`).expect(409)
  })

  it('expires on the business date rollover even without record changes', async () => {
    let now = new Date('2026-11-11T15:59:00Z')
    const { api, ctx } = testServer({ now: () => now })
    const app = createApp(ctx, eventDef(), { source: 'manual' })
    const p = await runPlan(ctx, scripted([checkinProposal()]), { appId: app.id, intent: '加签到' }, () => {})
    const preview = await api().get(`/api/proposals/${p!.id}/preview`).expect(200)
    now = new Date('2026-11-11T16:01:00Z')
    const response = await api()
      .post(`/api/proposals/${p!.id}/approve`)
      .send({ previewToken: preview.body.previewToken })
      .expect(409)
    expect(response.body.error.code).toBe('IMPACT_PREVIEW_STALE')
  })
})
