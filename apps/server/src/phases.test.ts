import { REGISTRY } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { withDesk } from '../../../packages/shared/src/test-helpers'
import { applyManualPatch, createApp, getApp } from './services/apps'
import { addConstraint } from './services/constraints'
import { createRecord, listStored } from './services/records'
import { PEER_HEADER, testServer } from './test-utils'

describe('human-confirmed business phases', () => {
  it('previews closure, blocks writes on both admin and shared pages, then can reopen without losing records', async () => {
    const { ctx, api } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const rec = createRecord(ctx, app.id, 'signup', { name: '甲', studentId: '1', major: '计算机' })
    const before = JSON.stringify(listStored(ctx, app.id))
    const base = `/api/apps/${app.id}`
    const active = (
      await api()
        .post(`${base}/phases`)
        .send({
          baseVersion: 1,
          name: '运行阶段',
          disabledNodes: app.definition.nodes
            .filter((n) => n.hidden && REGISTRY[n.type].visual)
            .map((n) => n.id),
        })
        .expect(201)
    ).body.phase
    const close = (
      await api()
        .post(`${base}/phases`)
        .send({
          baseVersion: 1,
          name: '结束阶段',
          disabledNodes: app.definition.nodes.filter((n) => REGISTRY[n.type].visual).map((n) => n.id),
        })
        .expect(201)
    ).body.phase
    const link = (await api().post(`${base}/views/desk/link`).expect(200)).body.token
    const pending = (await api().post(`${base}/phases/${close.id}/propose`).expect(200)).body.proposal
    expect(pending.origin).toBe('manual')
    expect(getApp(ctx, app.id).version).toBe(1)
    await api().get(`/api/v/${link}`).expect(200)
    const preview = (await api().get(`/api/proposals/${pending.id}/preview`).expect(200)).body
    await api()
      .post(`/api/proposals/${pending.id}/approve`)
      .send({ previewToken: preview.previewToken })
      .expect(200)
    await api().post(`${base}/actions/checkin`).send({ recordId: rec.id, answers: {} }).expect(403)
    await api()
      .post(`${base}/records`)
      .send({ nodeId: 'signup', values: { name: '乙', studentId: '2', major: '其他' } })
      .expect(403)
    await api().get(`/api/v/${link}`).expect(410)
    const resume = (await api().post(`${base}/phases/${active.id}/propose`).expect(200)).body.proposal
    await api().post(`/api/proposals/${resume.id}/approve`).expect(200)
    await api().get(`/api/v/${link}`).expect(200)
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(before)
    expect((await api().get(`${base}/versions`)).body.versions[0].source).toBe('manual')
    await api().delete(`${base}/phases/${close.id}`).expect(204)
    await api().delete(`${base}/phases/${close.id}`).expect(204)
    expect((await api().get(`${base}/phases`)).body.phases).toHaveLength(1)
  })

  it('cannot bypass persistent rules or silently ignore newly introduced components', async () => {
    const { ctx, api } = testServer()
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const base = `/api/apps/${app.id}`
    const phase = (
      await api()
        .post(`${base}/phases`)
        .send({
          baseVersion: 1,
          name: '停用签到台',
          disabledNodes: ['deskAction', 'deskRate', 'deskPending'],
        })
        .expect(201)
    ).body.phase
    addConstraint(ctx, app.id, 1, '保留签到台', {
      kind: 'allowedWrites',
      viewId: 'desk',
      fields: ['checkedIn'],
    })
    const conflict = await api().post(`${base}/phases/${phase.id}/propose`).expect(409)
    expect(conflict.body.error.code).toBe('PHASE_CONFLICT')
    expect(getApp(ctx, app.id).version).toBe(1)
    applyManualPatch(
      ctx,
      app.id,
      1,
      [
        {
          op: 'addNode',
          node: {
            id: 'extraForm',
            type: 'Form',
            params: { entityId: 'attendee', fields: ['name', 'studentId', 'major'] },
          },
        },
      ],
      '新增表单',
    )
    const stale = await api().post(`${base}/phases/${phase.id}/propose`).expect(409)
    expect(stale.body.error.code).toBe('PHASE_STALE')
    await api().get(`${base}/phases`).set(PEER_HEADER, '192.168.1.3').expect(403)
  })
})
