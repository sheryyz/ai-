import type { BusinessRule, PatchOp } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { withDesk } from '../../../packages/shared/src/test-helpers'
import { applyManualPatch, createApp, getApp } from './services/apps'
import { activeConstraints, addConstraint } from './services/constraints'
import { runPlan } from './services/planner'
import { approveProposal } from './services/proposals'
import { createRecord, listStored } from './services/records'
import { PEER_HEADER, scripted, testServer } from './test-utils'

const guard: BusinessRule = { kind: 'allowedWrites', viewId: 'desk', fields: ['checkedIn'] }
const widen: PatchOp[] = [{ op: 'updateNode', nodeId: 'deskAction', params: { ask: ['name'] } }]
const patch = (baseVersion: number, operations: PatchOp[]) => ({
  kind: 'patch',
  baseVersion,
  intent: '测试连续演进',
  summary: '调整组件',
  operations,
})

describe('persistent rules across edits, approvals and restores', () => {
  it('blocks a conflicting historical version until explicit revocation; preserves records and active rules across restore', async () => {
    const { api, ctx } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    createRecord(ctx, app.id, 'signup', { name: '甲', studentId: '1', major: '计算机' })
    applyManualPatch(ctx, app.id, 1, widen, '旧版允许修改姓名')
    applyManualPatch(
      ctx,
      app.id,
      2,
      [{ op: 'updateNode', nodeId: 'deskAction', params: { ask: [] } }],
      '收紧权限',
    )
    const before = JSON.stringify(listStored(ctx, app.id))
    const url = `/api/apps/${app.id}`
    const confirmed = await api()
      .post(`${url}/constraints`)
      .send({ baseVersion: 3, label: '志愿者只能签到', rule: guard })
      .expect(201)
    const id = confirmed.body.constraint.id
    const conflict = await api().get(`${url}/versions/2/diff`).expect(409)
    expect(conflict.body.error.code).toBe('CONSTRAINT_CONFLICT')
    await api().post(`${url}/versions/2/restore`).send({ baseVersion: 3 }).expect(409)
    expect(getApp(ctx, app.id).version).toBe(3)
    // Compatible restore retains the external rule, regardless of the restored definition's age.
    await api().post(`${url}/versions/1/restore`).send({ baseVersion: 3 }).expect(200)
    expect(activeConstraints(ctx, app.id).map((c) => c.id)).toEqual([id])
    expect(() => applyManualPatch(ctx, app.id, 4, widen, '试图扩大权限')).toThrow('志愿者只能签到')
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(before)
    await api().delete(`${url}/constraints/${id}`).expect(204)
    await api().delete(`${url}/constraints/${id}`).expect(204)
    await api().post(`${url}/versions/2/restore`).send({ baseVersion: 4 }).expect(200)
    expect(getApp(ctx, app.id).version).toBe(5)
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(before)
    const audit = ctx.db
      .prepare('SELECT type FROM audit_events WHERE app_id = ? AND type LIKE ?')
      .all(app.id, 'constraint.%')
    expect(audit.map((r) => r.type)).toEqual(['constraint.confirmed', 'constraint.revoked'])
  })

  it('revalidates pending proposals after a rule is confirmed, even without a preview token', async () => {
    const { ctx, api } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const p = await runPlan(
      ctx,
      scripted([patch(1, widen)]),
      { appId: app.id, intent: '允许志愿者改名' },
      () => {},
    )
    expect(p?.status).toBe('pending')
    addConstraint(ctx, app.id, 1, '只准签到', guard)
    const preview = await api().get(`/api/proposals/${p!.id}/preview`).expect(200)
    expect(preview.body.constraintIssues[0].code).toBe('BUSINESS_CONSTRAINT')
    await api().post(`/api/proposals/${p!.id}/approve`).send({ confirmExposure: true }).expect(409)
    expect(getApp(ctx, app.id).version).toBe(1)
    expect((await api().get(`/api/proposals/${p!.id}`)).body.proposal.status).toBe('pending')
  })

  it('keeps rules over three consecutive evolutions and feeds conflicts into the model repair loop', async () => {
    const { ctx } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    addConstraint(ctx, app.id, 1, '只准签到', guard)
    for (let version = 1; version <= 3; version++) {
      const model = scripted([
        patch(version, widen),
        patch(version, [{ op: 'updateApp', description: `第 ${version} 次改进` }]),
      ])
      const p = await runPlan(ctx, model, { appId: app.id, intent: '连续演进回归' }, () => {})
      expect(p?.status).toBe('pending')
      expect(p?.trace.rounds).toHaveLength(2)
      expect(p?.trace.rounds[0]?.issues[0]?.code).toBe('BUSINESS_CONSTRAINT')
      expect(JSON.stringify(model.calls[0])).toContain('持续业务约束')
      expect(JSON.stringify(model.calls[1])).toContain('BUSINESS_CONSTRAINT')
      approveProposal(ctx, p!.id)
      expect(activeConstraints(ctx, app.id)).toHaveLength(1)
    }
    expect(getApp(ctx, app.id).version).toBe(4)
  })

  it('requires admin access and a current version for confirming rules; deleted apps remain inaccessible', async () => {
    const { api, ctx } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const url = `/api/apps/${app.id}/constraints`
    const body = { baseVersion: 1, label: '只准签到', rule: guard }
    await api().post(url).set(PEER_HEADER, '192.168.1.15').send(body).expect(403)
    await api().get(url).set(PEER_HEADER, '192.168.1.15').expect(403)
    await api()
      .post(url)
      .send({ ...body, baseVersion: 2 })
      .expect(409)
    await api()
      .post(url)
      .send({ ...body, rule: { kind: 'allowedWrites', viewId: 'missing', fields: [] } })
      .expect(422)
    const added = await api().post(url).send(body).expect(201)
    const again = await api().post(url).send(body).expect(201)
    expect(again.body.constraint.id).toBe(added.body.constraint.id)
    await api().delete(`/api/apps/${app.id}`).expect(204)
    await api().get(url).expect(410)
    await api().delete(`${url}/${added.body.constraint.id}`).expect(410)
  })
})
