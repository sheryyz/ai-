import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PlanEvent, ProposalRecord } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './config'
import { LlmError } from './llm/client'
import { createReplayClient, type Recording } from './llm/replay'
import { parseModelJson, runPlan } from './services/planner'
import { createFromTemplate, parseStream, resultOf, scripted, testServer } from './test-utils'

const fixture = (p: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures', p), 'utf8'))
const eventTemplate = () => fixture('templates/event-registration.json')
const checkinPatch = (baseVersion = 1) => ({ ...fixture('proposals/event-checkin.patch.json'), baseVersion })

describe('parseModelJson', () => {
  it('accepts fenced or prose-wrapped JSON and reports real parse errors', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseModelJson('好的：{"a":1} 以上')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseModelJson('{"ok":##}').ok).toBe(false)
  })
})

describe('POST /api/ai/plan — create (AC-01 with a scripted model)', () => {
  it('streams the pipeline, stores a pending proposal and creates the app only on approval', async () => {
    const model = scripted([
      { kind: 'create', intent: '讲座报名', summary: '报名应用', definition: eventTemplate() },
    ])
    const { api } = testServer({ llm: model })
    const res = await api().post('/api/ai/plan').send({ intent: '创建一个校园讲座报名系统' }).expect(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    const events = parseStream(res.text)
    const stages = events.filter((e) => e.type === 'stage').map((e) => `${e.stage}:${e.status}`)
    expect(stages).toEqual([
      'understand:running',
      'understand:done',
      'plan:running',
      'plan:done',
      'generate:running',
      'generate:done',
      'validate:running',
      'validate:done',
      'ready:done',
    ])
    expect(events.some((e) => e.type === 'thinking')).toBe(true)
    const result = resultOf(events)
    expect(result?.outcome).toBe('pending')
    const p = result?.proposal as ProposalRecord
    expect(p.diff?.summary).toMatch(/^创建「校园讲座报名」/)
    expect(p.trace).toMatchObject({
      origin: 'live',
      model: 'scripted-test-model',
      promptVersion: expect.any(String),
    })

    expect((await api().get('/api/apps').expect(200)).body.apps).toHaveLength(0)
    const approved = await api().post(`/api/proposals/${p.id}/approve`).expect(200)
    expect(approved.body.app).toMatchObject({ version: 1, name: '校园讲座报名' })
    const versions = await api().get(`/api/apps/${approved.body.appId}/versions`).expect(200)
    expect(versions.body.versions[0]).toMatchObject({ source: 'ai', proposalId: p.id })

    await api().post(`/api/proposals/${p.id}/approve`).expect(409)
  })

  it('AC-10: without a key the planner is unavailable but the rest of the API works', async () => {
    const { api } = testServer()
    const res = await api().post('/api/ai/plan').send({ intent: '创建一个讲座报名系统' }).expect(503)
    expect(res.body.error.code).toBe('AI_UNAVAILABLE')
    await createFromTemplate(api, 'event-registration')
  })
})

describe('validator-in-the-loop (AC-13)', () => {
  it('repairs invalid JSON in the next round and shows the issues to the model and the user', async () => {
    const model = scripted([
      '{"ok":##}',
      { kind: 'create', intent: 'x', summary: '报名应用', definition: eventTemplate() },
    ])
    const { ctx } = testServer({ llm: model })
    const events: PlanEvent[] = []
    const saved = await runPlan(ctx, model, { intent: '创建报名系统' }, (e) => events.push(e))
    expect(saved?.status).toBe('pending')
    expect(saved?.trace.rounds).toHaveLength(2)
    expect(saved?.trace.rounds[0]?.issues[0]?.code).toBe('SCHEMA_JSON_PARSE')
    const issues = events.find((e) => e.type === 'issues')
    expect(issues).toMatchObject({ round: 0, repairable: true })
    expect(events).toContainEqual({ type: 'stage', stage: 'repair', status: 'done', round: 1 })
    const repairPrompt = model.calls[1]?.at(-1)?.content ?? ''
    expect(repairPrompt).toContain('SCHEMA_JSON_PARSE')
    expect(model.calls[1]?.at(-2)).toEqual({ role: 'assistant', content: '{"ok":##}' })
  })

  it('feeds structured type errors back and accepts the corrected definition', async () => {
    const broken = eventTemplate()
    broken.bindings[0].to.port = 'value' // Metric has no input port named "value"
    const model = scripted([
      { kind: 'create', intent: 'x', summary: 's', definition: broken },
      { kind: 'create', intent: 'x', summary: 's', definition: eventTemplate() },
    ])
    const { ctx } = testServer({ llm: model })
    const saved = await runPlan(ctx, model, { intent: '创建报名系统' }, () => {})
    expect(saved?.status).toBe('pending')
    expect(model.calls[1]?.at(-1)?.content).toMatch(/TYPE_PORT/)
  })

  it('gives up after 2 repair rounds with a clear error and leaves the app untouched', async () => {
    const model = scripted(['not json', '{"kind":', '{"kind":"patch"}'])
    const { api, ctx } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration', true)
    const events: PlanEvent[] = []
    const saved = await runPlan(ctx, model, { intent: '加一个签到功能', appId: app.id }, (e) =>
      events.push(e),
    )
    expect(model.calls).toHaveLength(3)
    expect(saved?.status).toBe('invalid')
    expect(resultOf(events)?.outcome).toBe('failed')
    expect(events.at(-2)).toEqual({ type: 'stage', stage: 'ready', status: 'failed' })
    const after = await api().get(`/api/apps/${app.id}`).expect(200)
    expect(after.body.app.version).toBe(1)
    await api().post(`/api/proposals/${saved?.id}/approve`).expect(409)
  })

  it('marks the stage the model failed in as failed, so no step is left running', async () => {
    const lastStatus = (events: PlanEvent[]) => {
      const m = new Map<string, string>()
      for (const e of events) if (e.type === 'stage') m.set(e.stage, e.status)
      return m
    }
    const failing = (afterContent: boolean) => ({
      ...scripted([]),
      async chat(_m: unknown, opts: { onContent?: (d: string) => void }) {
        if (afterContent) opts.onContent?.('{"kind":')
        throw new LlmError('LLM_NETWORK', '无法连接模型服务，请检查网络或 LLM_BASE_URL')
      },
    })
    for (const [afterContent, stage] of [
      [false, 'plan'],
      [true, 'generate'],
    ] as const) {
      const model = failing(afterContent)
      const { api, ctx } = testServer({ llm: model })
      const app = await createFromTemplate(api, 'event-registration', true)
      const events: PlanEvent[] = []
      const saved = await runPlan(ctx, model, { intent: '加一个签到功能', appId: app.id }, (e) =>
        events.push(e),
      )
      expect(saved).toBeNull()
      const status = lastStatus(events)
      expect([...status.values()]).not.toContain('running')
      expect(status.get(stage)).toBe('failed')
      expect(status.get('ready')).toBe('failed')
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'LLM_NETWORK' })
      const after = await api().get(`/api/apps/${app.id}`).expect(200)
      expect(after.body.app.version).toBe(1)
    }
  })

  it('asks for a create when the model answers a create task with a patch', async () => {
    const model = scripted([
      {
        kind: 'patch',
        intent: 'x',
        summary: 's',
        baseVersion: 1,
        operations: [{ op: 'hideNode', nodeId: 'a' }],
      },
      { kind: 'create', intent: 'x', summary: 's', definition: eventTemplate() },
    ])
    const { ctx } = testServer({ llm: model })
    const saved = await runPlan(ctx, model, { intent: '创建报名系统' }, () => {})
    expect(saved?.trace.rounds[0]?.issues[0]?.code).toBe('PROPOSAL_KIND_MISMATCH')
    expect(saved?.status).toBe('pending')
  })
})

describe('evolution and safety', () => {
  it('AC-03: approves an incremental patch; old records keep their data and read the default', async () => {
    const model = scripted([checkinPatch(1)])
    const { api } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration', true)
    const before = await api().get(`/api/apps/${app.id}/records`).expect(200)

    const res = await api().post('/api/ai/plan').send({ intent: '加一个签到功能', appId: app.id }).expect(200)
    const result = resultOf(parseStream(res.text))
    expect(result?.outcome).toBe('pending')
    const diff = result?.proposal.diff
    expect(diff?.fields.added.map((f) => f.id)).toEqual(['checkedIn'])
    expect(diff?.impacts[0]).toMatchObject({ kind: 'defaultFill', affectedRecords: 36 })
    expect(result?.proposal.after?.nodes.some((n) => n.id === 'checkin')).toBe(true)
    // The prompt carried statistics only, never record contents.
    expect(JSON.stringify(model.calls[0])).not.toContain(before.body.records[0].data.name)

    const approved = await api().post(`/api/proposals/${result?.proposal.id}/approve`).expect(200)
    expect(approved.body).toMatchObject({ version: 2, app: { version: 2 } })
    const recs = await api().get(`/api/apps/${app.id}/records`).expect(200)
    expect(recs.body.records).toEqual(before.body.records)

    const list = await api().get(`/api/apps/${app.id}/proposals`).expect(200)
    expect(list.body.proposals.map((p: ProposalRecord) => p.status)).toEqual(['approved'])
  })

  it('AC-07: a forbidden op is blocked at L5 without auto-repair, and no record is touched', async () => {
    const model = scripted([
      {
        kind: 'patch',
        intent: '删掉没签到的人',
        summary: '删除未签到记录',
        baseVersion: 1,
        operations: [{ op: 'deleteRecords', where: { field: 'major', operator: 'eq', value: '计算机' } }],
      },
    ])
    const { api, ctx } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration', true)
    const events: PlanEvent[] = []
    const saved = await runPlan(ctx, model, { intent: '把没签到的人删掉', appId: app.id }, (e) =>
      events.push(e),
    )
    expect(model.calls).toHaveLength(1)
    expect(resultOf(events)?.outcome).toBe('blocked')
    expect(saved?.issues[0]).toMatchObject({
      layer: 'safety',
      code: 'SAFETY_FORBIDDEN_OP',
      hint: expect.stringMatching(/Filter/),
    })
    expect((await api().get(`/api/apps/${app.id}`).expect(200)).body.app.recordCount).toBe(36)
  })

  it('evaluation baseline: "regenerate" asks for a full definition and validates it as a create', async () => {
    const regenerated = eventTemplate()
    regenerated.entities[0].fields = regenerated.entities[0].fields.filter(
      (f: { id: string }) => f.id !== 'phone',
    )
    for (const n of regenerated.nodes) {
      if (n.type === 'Table') n.params.columns = ['name', 'studentId', 'major', 'createdAt']
      if (n.type === 'Form') n.params.fields = ['name', 'studentId', 'major']
    }
    const model = scripted([
      { kind: 'create', intent: '去掉手机号', summary: '重生成', definition: regenerated },
    ])
    const { api, ctx } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration', true)
    const saved = await runPlan(
      ctx,
      model,
      { intent: '不再收集手机号', appId: app.id, strategy: 'regenerate' },
      () => {},
    )
    const task = model.calls[0]?.[1]?.content ?? ''
    expect(task).toContain('完整 AppDefinition')
    expect(task).toContain('"id":"phone"')
    // Structurally valid as a whole definition — the field removal is only visible against the old one,
    // which is exactly what the evaluation measures for strategy A.
    expect(saved).toMatchObject({ status: 'pending', kind: 'create' })
    expect(saved?.trace.promptVersion).toMatch(/\+regenerate-v1$/)
    expect(saved?.diff?.fromVersion).toBe(1)
  })

  it('stores a model refusal with its reason and suggestion', async () => {
    const model = scripted([
      {
        kind: 'refusal',
        intent: '重置数据',
        reason: '协议不允许删除业务记录',
        suggestion: '只在视图中隐藏未签到人员',
      },
    ])
    const { api, ctx } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration')
    const events: PlanEvent[] = []
    const saved = await runPlan(ctx, model, { intent: '重置所有数据', appId: app.id }, (e) => events.push(e))
    expect(resultOf(events)?.outcome).toBe('refused')
    expect(saved).toMatchObject({ status: 'refused', kind: 'refusal' })
    expect(saved?.proposal).toMatchObject({ suggestion: '只在视图中隐藏未签到人员' })
  })

  it('AC-08: approval fails with VERSION_CONFLICT when the app changed after planning', async () => {
    const model = scripted([checkinPatch(1)])
    const { api } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration')
    const res = await api().post('/api/ai/plan').send({ intent: '加签到', appId: app.id }).expect(200)
    const id = resultOf(parseStream(res.text))?.proposal.id
    await api().patch(`/api/apps/${app.id}`).send({ baseVersion: 1, name: '改过名的讲座' }).expect(200)
    const conflict = await api().post(`/api/proposals/${id}/approve`).expect(409)
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT')
    expect((await api().get(`/api/apps/${app.id}`).expect(200)).body.app.version).toBe(2)
  })

  it('rejecting keeps the app unchanged', async () => {
    const model = scripted([checkinPatch(1)])
    const { api } = testServer({ llm: model })
    const app = await createFromTemplate(api, 'event-registration')
    const res = await api().post('/api/ai/plan').send({ intent: '加签到', appId: app.id }).expect(200)
    const id = resultOf(parseStream(res.text))?.proposal.id
    const rejected = await api().post(`/api/proposals/${id}/reject`).expect(200)
    expect(rejected.body.proposal.status).toBe('rejected')
    expect((await api().get(`/api/apps/${app.id}`).expect(200)).body.app.version).toBe(1)
  })

  it('AC-07 (interface): manual validation reports forbidden ops and changes nothing', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    const res = await api()
      .post(`/api/apps/${app.id}/validate`)
      .send({
        kind: 'patch',
        intent: 'x',
        summary: 'x',
        baseVersion: 1,
        operations: [{ op: 'rawSQL', sql: 'DELETE FROM records' }],
      })
      .expect(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.issues[0]).toMatchObject({ layer: 'safety', code: 'SAFETY_FORBIDDEN_OP' })
    expect(res.body.recordCount).toBe(36)
  })
})

describe('replay of a recorded response', () => {
  // Synthetic recording for the test only; real recordings in fixtures/recorded/ come from live model calls.
  const rec: Recording = {
    id: 'test-checkin',
    title: '测试',
    kind: 'patch',
    intent: '加一个签到功能',
    model: 'deepseek-flash',
    recordedAt: '2026-11-11T12:00:00.000Z',
    promptVersion: 'planner-v1.0',
    temperature: 0.2,
    base: { version: 1, definition: eventTemplate() },
    rounds: [
      {
        reasoning: '思考',
        content: JSON.stringify(checkinPatch(1)),
        usage: null,
        finishReason: 'stop',
        ms: 1,
      },
    ],
  }

  it('runs through the same validation, is labelled recorded and rebases baseVersion transparently', async () => {
    const { api, ctx } = testServer()
    const app = await createFromTemplate(api, 'event-registration')
    await api().patch(`/api/apps/${app.id}`).send({ baseVersion: 1, name: '临时改名' }).expect(200)
    await api().post(`/api/apps/${app.id}/versions/1/restore`).send({ baseVersion: 2 }).expect(200)
    const saved = await runPlan(
      ctx,
      createReplayClient(rec, { speed: 0 }),
      {
        intent: rec.intent,
        appId: app.id,
        rebaseFrom: 1,
        recording: { id: rec.id, recordedAt: rec.recordedAt, model: rec.model },
      },
      () => {},
    )
    expect(saved).toMatchObject({ status: 'pending', origin: 'recorded', baseVersion: 3 })
    expect(saved?.trace.notes.join()).toMatch(/v1.*v3/)
    const approved = await api().post(`/api/proposals/${saved?.id}/approve`).expect(200)
    const versions = await api().get(`/api/apps/${app.id}/versions`).expect(200)
    expect(approved.body.version).toBe(4)
    expect(versions.body.versions[0].source).toBe('recorded')
  })
})
