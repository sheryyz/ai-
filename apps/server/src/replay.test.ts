// Offline demo regression: every recorded real model response must still replay to its recorded outcome
// through the current validator (if the protocol changes, re-run `npm run record-demos`).
import type { PlanEvent, RecordingInfo } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { loadRecordings } from './llm/replay'
import { testServer } from './test-utils'

const parse = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PlanEvent)
const result = (text: string) => {
  const r = parse(text).find((e) => e.type === 'result')
  if (r?.type !== 'result') throw new Error(`no result event:\n${text}`)
  return r
}

describe('recorded demos (offline mode, AC-10)', () => {
  const recs = loadRecordings()

  it('ships recordings for both scenarios, each labelled with model and time', () => {
    expect(recs.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        '01-event-create',
        '02-event-checkin',
        '03-event-delete',
        '04-equipment-create',
        '05-equipment-overdue',
      ]),
    )
    for (const r of recs)
      expect(r).toMatchObject({ model: expect.any(String), recordedAt: expect.any(String) })
  })

  it('replays scenario A end to end without a key: create → check-in → refused delete → restore keeps data', async () => {
    const { api } = testServer()
    const list = await api().get('/api/recordings').expect(200)
    expect(list.body.recordings.find((r: RecordingInfo) => r.id === '01-event-create')).toMatchObject({
      applicable: true,
    })

    const created = result(
      (await api().post('/api/ai/plan').send({ recordingId: '01-event-create' }).expect(200)).text,
    )
    expect(created).toMatchObject({ outcome: 'pending', proposal: { origin: 'recorded' } })
    const app = (await api().post(`/api/proposals/${created.proposal.id}/approve`).expect(200)).body.app

    const form = app.definition.nodes.find((n: { type: string }) => n.type === 'Form')
    const entity = app.definition.entities[0]
    const values = Object.fromEntries(
      form.params.fields.map((id: string) => {
        const f = entity.fields.find((x: { id: string }) => x.id === id)
        return [id, f.type === 'enum' ? f.options[0] : `测试${id}`]
      }),
    )
    await api().post(`/api/apps/${app.id}/records`).send({ nodeId: form.id, values }).expect(201)

    const applicable = await api().get(`/api/recordings?appId=${app.id}`).expect(200)
    expect(
      applicable.body.recordings.find((r: RecordingInfo) => r.id === '02-event-checkin').applicable,
    ).toBe(true)
    const patch = result(
      (await api().post('/api/ai/plan').send({ recordingId: '02-event-checkin', appId: app.id }).expect(200))
        .text,
    )
    expect(patch.outcome).toBe('pending')
    expect(patch.proposal.diff?.fields.added.length).toBeGreaterThan(0)
    await api().post(`/api/proposals/${patch.proposal.id}/approve`).expect(200)

    const refused = result(
      (await api().post('/api/ai/plan').send({ recordingId: '03-event-delete', appId: app.id }).expect(200))
        .text,
    )
    expect(['refused', 'blocked']).toContain(refused.outcome)

    const before = (await api().get(`/api/apps/${app.id}/records`).expect(200)).body.records
    await api().post(`/api/apps/${app.id}/versions/1/restore`).send({ baseVersion: 2 }).expect(200)
    expect((await api().get(`/api/apps/${app.id}/records`).expect(200)).body.records).toEqual(before)
  })

  it('AC-04: scenario B is generated from scratch, used for lending, then evolved to flag overdue devices', async () => {
    const { api } = testServer()
    const r = result(
      (await api().post('/api/ai/plan').send({ recordingId: '04-equipment-create' }).expect(200)).text,
    )
    expect(r.outcome).toBe('pending')
    const app = (await api().post(`/api/proposals/${r.proposal.id}/approve`).expect(200)).body.app
    const nodeOf = (type: string, label?: string) =>
      app.definition.nodes.find(
        (n: { type: string; params: { label?: string } }) =>
          n.type === type && (!label || n.params.label?.includes(label)),
      ).id
    const form = nodeOf('Form')
    const lend = nodeOf('QuickAction', '借出')
    const giveBack = nodeOf('QuickAction', '归还')

    // Register devices through the generated form (FIXED_NOW is 2026-11-11).
    const add = async (name: string, code: string) =>
      (
        await api()
          .post(`/api/apps/${app.id}/records`)
          .send({ nodeId: form, values: { name, code, category: '相机', status: '可借用' } })
          .expect(201)
      ).body.record.id as string
    const camera = await add('单反相机', 'CAM-01')
    const tripod = await add('三脚架', 'CAM-02')
    const spare = await add('备用镜头', 'CAM-03')

    const lent = await api()
      .post(`/api/apps/${app.id}/actions/${lend}`)
      .send({ recordId: camera, answers: { borrower: '王同学', borrowDate: '2026-11-01' } })
      .expect(200)
    expect(lent.body.record.values).toMatchObject({ status: '已借出', borrower: '王同学' })
    await api()
      .post(`/api/apps/${app.id}/actions/${lend}`)
      .send({ recordId: tripod, answers: { borrower: '李老师', borrowDate: '2026-11-09' } })
      .expect(200)
    await api()
      .post(`/api/apps/${app.id}/actions/${lend}`)
      .send({ recordId: spare, answers: { borrower: '赵同学', borrowDate: '2026-10-20' } })
      .expect(200)
    const back = await api()
      .post(`/api/apps/${app.id}/actions/${giveBack}`)
      .send({ recordId: spare })
      .expect(200)
    expect(back.body.record.values.status).not.toBe('已借出')

    // Evolve: only devices still lent out for more than 7 days are flagged.
    const before = (await api().get(`/api/apps/${app.id}/records`)).body.records
    const patch = result(
      (
        await api()
          .post('/api/ai/plan')
          .send({ recordingId: '05-equipment-overdue', appId: app.id })
          .expect(200)
      ).text,
    )
    expect(patch.outcome).toBe('pending')
    expect(patch.proposal.diff?.fields.added).toEqual([])
    const evolved = (await api().post(`/api/proposals/${patch.proposal.id}/approve`).expect(200)).body.app
    const overdue = evolved.definition.nodes.find(
      (n: { id: string; type: string }) =>
        n.type === 'Table' && !app.definition.nodes.some((o: { id: string }) => o.id === n.id),
    )
    const csv = await api().get(`/api/apps/${app.id}/export.csv?node=${overdue.id}`).expect(200)
    expect(csv.headers['x-record-count']).toBe('1')
    expect(csv.text).toContain('CAM-01')
    expect((await api().get(`/api/apps/${app.id}/records`)).body.records).toEqual(before)
  })

  it('refuses to replay a patch onto an app whose structure differs from the recording', async () => {
    const { api } = testServer()
    const app = (await api().post('/api/apps').send({ templateId: 'event-registration' }).expect(201)).body
      .app
    const res = await api()
      .post('/api/ai/plan')
      .send({ recordingId: '02-event-checkin', appId: app.id })
      .expect(409)
    expect(res.body.error.code).toBe('RECORDING_NOT_APPLICABLE')
  })
})
