import type { IntentBrief, ProposalRecord } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { eventDef, withDesk } from '../../../packages/shared/src/test-helpers'
import { createApp, getApp } from './services/apps'
import { addConstraint } from './services/constraints'
import { generateOptions, prepareIntent } from './services/guidance'
import { runPlan } from './services/planner'
import { approveProposal, getProposal, saveProposal } from './services/proposals'
import { createRecord, listStored } from './services/records'
import { PEER_HEADER, scripted, testServer } from './test-utils'

const brief: IntentBrief = {
  summary: '明确操作范围后优化界面',
  questions: [
    {
      question: '允许谁操作？',
      reason: '决定权限范围',
      options: [
        { label: '管理者', effect: '保留管理页' },
        { label: '协助者', effect: '新增受限角色页' },
      ],
    },
  ],
  alternatives: [
    { title: '紧凑方案', approach: '保留组件，调整布局', tradeoff: '变化较小' },
    { title: '清晰方案', approach: '保留组件，完善说明', tradeoff: '更多说明文字' },
  ],
}
const patch = (description: string, baseVersion = 1) => ({
  kind: 'patch',
  baseVersion,
  intent: '改进界面',
  summary: description,
  operations: [{ op: 'updateApp', description }],
})

describe('guided intent and alternative lifecycle', () => {
  it('requires explicit answers, stores provenance, previews both on the same snapshot and approves exactly one', async () => {
    const model = scripted([brief, patch('方案 A'), patch('方案 B')])
    const { api, ctx } = testServer({ llm: model })
    const app = createApp(ctx, eventDef(), { source: 'manual' })
    createRecord(ctx, app.id, 'signup', { name: '不应发给模型的姓名', studentId: '1', major: '计算机' })
    const before = JSON.stringify(listStored(ctx, app.id))
    const prepared = (
      await api().post('/api/ai/prepare').send({ appId: app.id, intent: '改进界面' }).expect(200)
    ).body.prepared
    expect(model.calls).toHaveLength(1)
    expect(JSON.stringify(model.calls[0])).not.toContain('不应发给模型的姓名')
    await api()
      .post('/api/ai/options')
      .send({ briefId: prepared.id, answers: [], choice: 'compare' })
      .expect(422)
    expect(model.calls).toHaveLength(1)
    const generated = await api()
      .post('/api/ai/options')
      .send({ briefId: prepared.id, answers: [0], choice: 'compare' })
      .expect(200)
    const options = generated.body.proposals as ProposalRecord[]
    expect(options).toHaveLength(2)
    expect(options.map((p) => p.baseVersion)).toEqual([1, 1])
    expect(JSON.stringify(model.calls[1])).toContain('管理者')
    expect(getApp(ctx, app.id).version).toBe(1)
    const previews = (await api().get(`/api/proposal-groups/${prepared.id}`).expect(200)).body.options
    expect(
      previews.map((o: { preview: { impact: { recordCount: number } } }) => o.preview.impact.recordCount),
    ).toEqual([1, 1])
    await api()
      .post(`/api/proposals/${options[0]!.id}/approve`)
      .send({ previewToken: previews[0].preview.previewToken })
      .expect(200)
    expect(getProposal(ctx, options[1]!.id).status).toBe('rejected')
    const confirmed = (await api().get(`/api/intent-briefs/${prepared.id}`).expect(200)).body.prepared
    expect(confirmed.resolution).toEqual({ answers: [0], choice: 'compare' })
    await api().post(`/api/proposals/${options[1]!.id}/approve`).expect(409)
    expect(getApp(ctx, app.id).version).toBe(2)
    expect(JSON.stringify(listStored(ctx, app.id))).toBe(before)
    await api()
      .post('/api/ai/options')
      .send({ briefId: prepared.id, answers: [0], choice: 0 })
      .expect(409)
    expect(
      ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_events WHERE type IN ('intent.prepared', 'intent.confirmed')",
        )
        .get()?.n,
    ).toBe(2)
  })

  it('also prevents creating two apps from a single comparison', async () => {
    const model = scripted([
      { ...brief, questions: [] },
      { kind: 'create', intent: '创建', summary: 'A', definition: eventDef() },
      { kind: 'create', intent: '创建', summary: 'B', definition: { ...eventDef(), description: 'B' } },
    ])
    const { ctx } = testServer({ llm: model })
    const prepared = await prepareIntent(ctx, { intent: '创建一个报名应用' })
    const generated = await generateOptions(ctx, { briefId: prepared.id, answers: [], choice: 'compare' })
    approveProposal(ctx, generated.proposals[0]!.id)
    expect(() => approveProposal(ctx, generated.proposals[1]!.id)).toThrow()
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM apps').get()?.n).toBe(1)
    const late = saveProposal(ctx, {
      ...generated.proposals[1]!,
      appId: null,
      status: 'pending',
      groupId: prepared.id,
      parentId: undefined,
      optionLabel: '较晚完成的候选',
    })
    expect(late.status).toBe('rejected')
    expect(() => approveProposal(ctx, late.id)).toThrow()
  })

  it('invalidates a prepared decision when rules change, and rejects cross-app repair and remote access', async () => {
    const { ctx, api } = testServer({ llm: scripted([brief]) })
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const prepared = await prepareIntent(ctx, { appId: app.id, intent: '改进界面' })
    addConstraint(ctx, app.id, 1, '仅签到', { kind: 'allowedWrites', viewId: 'desk', fields: ['checkedIn'] })
    await api()
      .post('/api/ai/options')
      .send({ briefId: prepared.id, answers: [0], choice: 0 })
      .expect(409)
    await api().get(`/api/intent-briefs/${prepared.id}`).set(PEER_HEADER, '192.168.1.22').expect(403)
    await api()
      .post('/api/ai/prepare')
      .set(PEER_HEADER, '192.168.1.22')
      .send({ intent: '生成应用' })
      .expect(403)
    const p = await runPlan(ctx, scripted([patch('新描述')]), { intent: '新描述', appId: app.id }, () => {})
    const other = createApp(ctx, eventDef(), { source: 'manual' })
    await api().post('/api/ai/prepare').send({ intent: '修复', appId: other.id, parentId: p!.id }).expect(409)
  })

  it('offers an explicit repair, keeps the original pending until approval and enforces its rules', async () => {
    const model = scripted([{ ...brief, questions: [] }, patch('在不扩大权限的前提下更新说明')])
    const { ctx } = testServer({ llm: model })
    const app = createApp(ctx, withDesk(), { source: 'manual' })
    const original = await runPlan(
      ctx,
      scripted([
        {
          ...patch('扩大权限'),
          operations: [{ op: 'updateNode', nodeId: 'deskAction', params: { ask: ['name'] } }],
        },
      ]),
      { appId: app.id, intent: '让志愿者核对姓名' },
      () => {},
    )
    addConstraint(ctx, app.id, 1, '仅签到', { kind: 'allowedWrites', viewId: 'desk', fields: ['checkedIn'] })
    const prepared = await prepareIntent(ctx, {
      appId: app.id,
      intent: original!.intent,
      parentId: original!.id,
    })
    expect(JSON.stringify(model.calls[0])).toContain('BUSINESS_CONSTRAINT')
    const result = await generateOptions(ctx, { briefId: prepared.id, answers: [], choice: 0 })
    expect(result.proposals[0]?.parentId).toBe(original!.id)
    expect(getProposal(ctx, original!.id).status).toBe('pending')
    approveProposal(ctx, result.proposals[0]!.id)
    expect(getProposal(ctx, original!.id).status).toBe('rejected')
  })

  it('does not consume a brief for invalid model JSON and leaves applications untouched', async () => {
    const { ctx, api } = testServer({ llm: scripted(['bad-json']) })
    const app = createApp(ctx, eventDef(), { source: 'manual' })
    await api().post('/api/ai/prepare').send({ appId: app.id, intent: '改进界面' }).expect(422)
    expect(getApp(ctx, app.id).version).toBe(1)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM intent_briefs').get()?.n).toBe(0)
  })
})
