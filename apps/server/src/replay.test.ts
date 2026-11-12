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
        '06-event-signup-page',
        '07-event-desk',
        '08-event-export',
      ]),
    )
    for (const r of recs)
      expect(r).toMatchObject({ model: expect.any(String), recordedAt: expect.any(String) })
  })

  it('replays scenario A end to end without a key: create → sign-up page → check-in → desk → export needs confirmation → refused delete → restore', async () => {
    const { api } = testServer()
    const list = await api().get('/api/recordings').expect(200)
    expect(list.body.recordings.find((r: RecordingInfo) => r.id === '01-event-create')).toMatchObject({
      applicable: true,
    })
    const replay = async (recordingId: string, appId?: string) =>
      result((await api().post('/api/ai/plan').send({ recordingId, appId }).expect(200)).text)

    const created = await replay('01-event-create')
    expect(created).toMatchObject({ outcome: 'pending', proposal: { origin: 'recorded' } })
    const app = (await api().post(`/api/proposals/${created.proposal.id}/approve`).expect(200)).body.app
    // planner-v1.2 marks fields that identify a person (protocol §11.3).
    const sensitive = app.definition.entities[0].fields.filter((f: { sensitive?: boolean }) => f.sensitive)
    expect(sensitive.map((f: { label: string }) => f.label)).toEqual(['学号', '手机号'])

    const signup = await replay('06-event-signup-page', app.id)
    expect(signup.outcome).toBe('pending')
    expect(signup.proposal.diff?.views.added).toHaveLength(1)
    expect(signup.proposal.diff?.confirmExposure).toBe(false)
    await api().post(`/api/proposals/${signup.proposal.id}/approve`).expect(200)

    // Records arrive through the admin form; the share page form is checked separately below.
    const def = (await api().get(`/api/apps/${app.id}`)).body.app.definition
    const form = def.nodes.find((n: { type: string; view?: string }) => n.type === 'Form' && !n.view)
    const entity = def.entities[0]
    const values = (i: number) =>
      Object.fromEntries(
        form.params.fields.map((id: string) => {
          const f = entity.fields.find((x: { id: string }) => x.id === id)
          return [
            id,
            f.type === 'enum' ? f.options[0] : id === 'phone' ? `1380000${1000 + i}` : `测试${id}${i}`,
          ]
        }),
      )
    for (let i = 0; i < 3; i++)
      await api()
        .post(`/api/apps/${app.id}/records`)
        .send({ nodeId: form.id, values: values(i) })
        .expect(201)

    const applicable = await api().get(`/api/recordings?appId=${app.id}`).expect(200)
    expect(
      applicable.body.recordings.find((r: RecordingInfo) => r.id === '02-event-checkin').applicable,
    ).toBe(true)
    const checkin = await replay('02-event-checkin', app.id)
    expect(checkin.outcome).toBe('pending')
    expect(checkin.proposal.diff?.fields.added.length).toBeGreaterThan(0)
    await api().post(`/api/proposals/${checkin.proposal.id}/approve`).expect(200)

    const desk = await replay('07-event-desk', app.id)
    expect(desk.outcome).toBe('pending')
    const deskView = desk.proposal.diff?.exposure.find((e) => e.before === null)?.after
    expect(deskView).toMatchObject({ restricted: ['phone'], sensitiveRead: [] })
    expect(deskView?.read).not.toContain('phone')
    await api().post(`/api/proposals/${desk.proposal.id}/approve`).expect(200)

    // The recorded model kept phone out but showed student ids: the server insists on confirmation.
    const exported = await replay('08-event-export', app.id)
    expect(exported.outcome).toBe('pending')
    expect(exported.proposal.diff).toMatchObject({ confirmExposure: true, risk: 'high' })
    const needs = await api().post(`/api/proposals/${exported.proposal.id}/approve`).expect(409)
    expect(needs.body.error.code).toBe('EXPOSURE_CONFIRM_REQUIRED')
    await api().post(`/api/proposals/${exported.proposal.id}/reject`).expect(200)

    const refused = await replay('03-event-delete', app.id)
    expect(['refused', 'blocked']).toContain(refused.outcome)

    // Share link of the desk: no phone numbers; inactive after restoring to before the desk.
    const deskId = deskView?.viewId as string
    const token = (await api().post(`/api/apps/${app.id}/views/${deskId}/link`).expect(200)).body.token
    const snap = await api().get(`/api/v/${token}`).expect(200)
    expect(snap.text).not.toMatch(/1380000\d{4}/)

    const before = (await api().get(`/api/apps/${app.id}/records`).expect(200)).body.records
    await api().post(`/api/apps/${app.id}/versions/1/restore`).send({ baseVersion: 4 }).expect(200)
    await api().get(`/api/v/${token}`).expect(410)
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
