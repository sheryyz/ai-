import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProposalRecord, ViewLinkInfo, ViewSnapshot } from '@morphos/shared'
import { describe, expect, it } from 'vitest'
import { isLoopback } from './access'
import { REPO_ROOT } from './config'
import { createFromTemplate, PEER_HEADER, parseStream, resultOf, scripted, testServer } from './test-utils'

const fixture = (p: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures', p), 'utf8'))
const samples = fixture('samples/event-registration.json').records as {
  name: string
  studentId: string
  phone: string | null
}[]
const PHONE = /1380000\d{4}/

const exportOnDesk = (params: Record<string, unknown>, baseVersion: number) => ({
  kind: 'patch',
  intent: '让志愿者也能导出名单',
  summary: '签到台新增导出',
  baseVersion,
  operations: [
    { op: 'addNode', node: { id: 'deskExport', type: 'CSVExport', view: 'desk', order: 2, params } },
    {
      op: 'bind',
      binding: {
        id: 'b_de',
        from: { node: 'source', port: 'records' },
        to: { node: 'deskExport', port: 'rows' },
      },
    },
  ],
})

/**
 * An event app taken through the real pipeline with a scripted model:
 * v1 template (+ sample records) → v2 check-in (AC-03) → v3 volunteer desk view with phone restricted.
 */
async function eventWithDesk(opts: { env?: Record<string, string> } = {}) {
  const outputs: object[] = []
  const model = scripted(outputs)
  const server = testServer({ llm: model, env: opts.env })
  const { api } = server
  const app = await createFromTemplate(api, 'event-registration', true)

  /** Runs one planning turn with the given model output and returns the stored proposal. */
  const plan = async (output: object, ...more: object[]) => {
    outputs.push(output, ...more)
    const res = await api().post('/api/ai/plan').send({ intent: '测试', appId: app.id }).expect(200)
    return resultOf(parseStream(res.text))?.proposal as ProposalRecord
  }
  const approve = (p: ProposalRecord, body: object = {}) =>
    api().post(`/api/proposals/${p.id}/approve`).send(body)

  await approve(await plan(fixture('proposals/event-checkin.patch.json'))).expect(200)
  await approve(await plan(fixture('proposals/event-desk.patch.json'))).expect(200)
  const token = (await api().post(`/api/apps/${app.id}/views/desk/link`).expect(200)).body.token as string
  return { ...server, model, app, plan, approve, token }
}

const deskRows = (snap: ViewSnapshot) => {
  const n = snap.nodes.find((x) => x.node.id === 'deskAction')
  return n?.data.kind === 'rows' ? n.data.rows : []
}

describe('share links (protocol §11.4)', () => {
  it('lists views with their exposure and hands out one stable token per view', async () => {
    const { api, app, token } = await eventWithDesk()
    const views = (await api().get(`/api/apps/${app.id}/views`).expect(200)).body.views as ViewLinkInfo[]
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      viewId: 'desk',
      label: '签到台',
      audience: '门口志愿者',
      token,
      active: true,
    })
    expect(views[0]?.exposure).toMatchObject({ read: ['name'], write: ['checkedIn'], restricted: ['phone'] })
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect((await api().post(`/api/apps/${app.id}/views/desk/link`).expect(200)).body.token).toBe(token)
    await api().post(`/api/apps/${app.id}/views/nope/link`).expect(404)
  })

  it('AC-16: the snapshot carries only what the desk shows — no phone numbers, no student ids', async () => {
    const { api, token } = await eventWithDesk()
    const res = await api().get(`/api/v/${token}`).expect(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.text).not.toMatch(PHONE)
    for (const s of samples) expect(res.text).not.toContain(s.studentId)
    const snap = res.body.snapshot as ViewSnapshot
    expect(snap.view).toMatchObject({ id: 'desk', label: '签到台', audience: '门口志愿者' })
    expect(snap.entity.fields.map((f) => f.id)).toEqual(['name', 'checkedIn'])
    expect(snap.nodes.map((n) => n.node.id)).toEqual(['deskRate', 'deskAction', 'deskPending'])
    expect(deskRows(snap)).toHaveLength(samples.length)
  })

  it('AC-16: writes go only through components of this view, and come back trimmed', async () => {
    const { api, app, token, ctx } = await eventWithDesk()
    const target = deskRows((await api().get(`/api/v/${token}`)).body.snapshot)[0]!

    const done = await api()
      .post(`/api/v/${token}/actions/deskAction`)
      .send({ recordId: target.id })
      .expect(200)
    expect(done.body.record).toEqual({
      id: target.id,
      createdAt: '',
      updatedAt: '',
      values: { name: target.values.name },
    })
    const stored = (await api().get(`/api/apps/${app.id}/records`)).body.records.find(
      (r: { id: string }) => r.id === target.id,
    )
    expect(stored.data.checkedIn).toBe(true)
    const event = ctx.db
      .prepare(
        "SELECT detail_json FROM audit_events WHERE type = 'quickaction.executed' ORDER BY id DESC LIMIT 1",
      )
      .get() as { detail_json: string }
    expect(JSON.parse(event.detail_json)).toMatchObject({
      recordId: target.id,
      via: 'deskAction',
      viaView: 'desk',
    })

    // The desk only lists people not yet checked in, so the same record is no longer in range.
    const again = await api()
      .post(`/api/v/${token}/actions/deskAction`)
      .send({ recordId: target.id })
      .expect(404)
    expect(again.body.error.code).toBe('RECORD_NOT_ELIGIBLE')

    // Admin-page components are out of reach through the link, whatever their type.
    for (const [method, url, body] of [
      ['post', `/api/v/${token}/actions/checkin`, { recordId: target.id }],
      [
        'post',
        `/api/v/${token}/records`,
        { nodeId: 'signup', values: { name: 'x', studentId: '1', major: '其他' } },
      ],
      ['post', `/api/v/${token}/outbox`, { nodeId: 'remind' }],
      ['get', `/api/v/${token}/export.csv?node=exportAll`, undefined],
      ['get', `/api/v/${token}/export.csv?node=roster`, undefined],
    ] as const) {
      const r = await (method === 'get' ? api().get(url) : api().post(url).send(body)).expect(404)
      expect(r.body.error.code).toBe('NODE_NOT_IN_VIEW')
    }
    // There is no edit or delete endpoint under a share link at all.
    await api()
      .patch(`/api/v/${token}/records/${target.id}`)
      .send({ values: { phone: '1' } })
      .expect(404)
    await api().delete(`/api/v/${token}/records/${target.id}`).expect(404)
  })

  it('a sign-up page accepts only its form fields and answers with nothing but the new id', async () => {
    const outputs: object[] = [fixture('proposals/event-signup-page.patch.json')]
    const { api } = testServer({ llm: scripted(outputs) })
    const app = await createFromTemplate(api, 'event-registration')
    const plan = await api().post('/api/ai/plan').send({ intent: '报名页', appId: app.id }).expect(200)
    const p = resultOf(parseStream(plan.text))?.proposal as ProposalRecord
    // Filling in one's own phone number is not exposure: no confirmation needed (protocol §11.3).
    expect(p.diff?.confirmExposure).toBe(false)
    await api().post(`/api/proposals/${p.id}/approve`).expect(200)
    const token = (await api().post(`/api/apps/${app.id}/views/signupPage/link`)).body.token

    const values = { name: '测试同学', studentId: '20249999', major: '数学', phone: '13800009999' }
    const created = await api()
      .post(`/api/v/${token}/records`)
      .send({ nodeId: 'publicForm', values })
      .expect(201)
    expect(created.body).toEqual({ record: { id: expect.any(String) } })
    const bad = await api()
      .post(`/api/v/${token}/records`)
      .send({ nodeId: 'publicForm', values: { ...values, note: '多余字段' } })
      .expect(422)
    expect(bad.body.error.code).toBe('RECORD_INVALID')

    const snap = (await api().get(`/api/v/${token}`).expect(200)).text
    expect(snap).not.toContain('13800009999')
    expect(snap).not.toContain('测试同学')
  })

  it('reset revokes the old link at once; unknown and malformed tokens are rejected alike', async () => {
    const { api, app, token } = await eventWithDesk()
    const fresh = (await api().post(`/api/apps/${app.id}/views/desk/link/reset`).expect(200)).body.token
    expect(fresh).not.toBe(token)
    expect((await api().get(`/api/v/${token}`).expect(404)).body.error.code).toBe('LINK_INVALID')
    await api().get(`/api/v/${fresh}`).expect(200)
    for (const t of ['x', 'A'.repeat(24), '../../apps']) {
      await api()
        .get(`/api/v/${encodeURIComponent(t)}`)
        .expect(404)
    }
  })
})

describe('AC-21: restoring versions switches links off and on, records untouched', () => {
  it('restore to before the desk → 410; restore forward → the same link works again', async () => {
    const { api, app, token } = await eventWithDesk()
    const before = (await api().get(`/api/apps/${app.id}/records`)).text

    await api().post(`/api/apps/${app.id}/versions/2/restore`).send({ baseVersion: 3 }).expect(200)
    const gone = await api().get(`/api/v/${token}`).expect(410)
    expect(gone.body.error).toMatchObject({ code: 'VIEW_INACTIVE', message: '此页面已停用，请联系组织者' })

    await api().post(`/api/apps/${app.id}/versions/3/restore`).send({ baseVersion: 4 }).expect(200)
    await api().get(`/api/v/${token}`).expect(200)
    expect((await api().get(`/api/apps/${app.id}/records`)).text).toBe(before)
  })

  it('hiding every component of a view also makes its link inactive', async () => {
    const { api, plan, approve, token } = await eventWithDesk()
    const hide = (nodeId: string) => ({ op: 'hideNode', nodeId })
    await approve(
      await plan({
        kind: 'patch',
        intent: '先关掉签到台',
        summary: '隐藏签到台组件',
        baseVersion: 3,
        operations: [hide('deskRate'), hide('deskAction'), hide('deskPending')],
      }),
    ).expect(200)
    await api().get(`/api/v/${token}`).expect(410)
  })
})

describe('AC-17 / AC-18: exposure in the pipeline and at approval (protocol §11.2, §11.5)', () => {
  it('AC-18: exporting the full list onto the desk is caught at L7 and repaired by the model', async () => {
    const { model, plan } = await eventWithDesk()
    const p = await plan(
      exportOnDesk({ filename: '名单' }, 3),
      exportOnDesk({ filename: '名单', columns: ['name'] }, 3),
    )
    expect(p.status).toBe('pending')
    expect(p.trace.rounds).toHaveLength(2)
    expect(p.trace.rounds[0]?.issues.map((i) => i.code)).toContain('EXPOSURE_RESTRICTED_FIELD')
    // The repair turn tells the model what crossed the line and how to fix it.
    const repair = JSON.stringify(model.calls.at(-1))
    expect(repair).toContain('EXPOSURE_RESTRICTED_FIELD')
    expect(repair).toContain('columns')
    expect(p.diff?.confirmExposure).toBe(false)
  })

  it('AC-17: showing student ids on the desk needs confirmation, enforced by the server', async () => {
    const { api, app, plan, approve, ctx } = await eventWithDesk()
    const p = await plan(exportOnDesk({ filename: '名单', columns: ['name', 'studentId'] }, 3))
    expect(p.status).toBe('pending')
    expect(p.issues.map((i) => i.code)).toContain('EXPOSURE_SENSITIVE_FIELD')
    expect(p.diff).toMatchObject({ confirmExposure: true, risk: 'high' })

    const refused = await approve(p).expect(409)
    expect(refused.body.error.code).toBe('EXPOSURE_CONFIRM_REQUIRED')
    expect(refused.body.error.message).toContain('学号')
    expect(refused.body.error.details).toEqual([
      {
        viewId: 'desk',
        label: '签到台',
        audience: '门口志愿者',
        fields: [{ id: 'studentId', label: '学号' }],
      },
    ])
    expect((await api().get(`/api/apps/${app.id}`)).body.app.version).toBe(3)

    await approve(p, { confirmExposure: true }).expect(200)
    expect((await api().get(`/api/apps/${app.id}`)).body.app.version).toBe(4)
    const audit = ctx.db
      .prepare("SELECT detail_json FROM audit_events WHERE type = 'exposure.confirmed'")
      .all() as { detail_json: string }[]
    expect(audit.map((a) => JSON.parse(a.detail_json))).toEqual([
      { proposalId: p.id, version: 4, views: refused.body.error.details },
    ])

    // Bringing that exposure back by restoring a version needs the same confirmation.
    await api().post(`/api/apps/${app.id}/versions/3/restore`).send({ baseVersion: 4 }).expect(200)
    const restore = await api()
      .post(`/api/apps/${app.id}/versions/4/restore`)
      .send({ baseVersion: 5 })
      .expect(409)
    expect(restore.body.error.code).toBe('EXPOSURE_CONFIRM_REQUIRED')
    await api()
      .post(`/api/apps/${app.id}/versions/4/restore`)
      .send({ baseVersion: 5, confirmExposure: true })
      .expect(200)
  })
})

describe('AC-20: the admin API answers only this machine (ADR-0008)', () => {
  const phone = { [PEER_HEADER]: '192.168.1.23' }

  it('rejects other devices on admin routes but serves them share links and health', async () => {
    const { api, app, token } = await eventWithDesk()
    for (const url of ['/api/apps', `/api/apps/${app.id}`, `/api/apps/${app.id}/records`, '/api/templates']) {
      const r = await api().get(url).set(phone).expect(403)
      expect(r.body.error.code).toBe('ADMIN_LOCAL_ONLY')
    }
    await api().post('/api/apps').set(phone).send({ templateId: 'event-registration' }).expect(403)
    await api().post(`/api/apps/${app.id}/views/desk/link/reset`).set(phone).expect(403)
    await api().get('/api/health').set(phone).expect(200)
    const snap = (await api().get(`/api/v/${token}`).set(phone).expect(200)).body.snapshot
    await api()
      .post(`/api/v/${token}/actions/deskAction`)
      .set(phone)
      .send({ recordId: deskRows(snap)[0]!.id })
      .expect(200)
  })

  it('decides by the peer address only; forwarding headers grant nothing', async () => {
    const { api } = await eventWithDesk()
    await api()
      .get('/api/apps')
      .set({ ...phone, 'X-Forwarded-For': '127.0.0.1' })
      .expect(403)
    await api()
      .get('/api/apps')
      .set({ [PEER_HEADER]: '::ffff:127.0.0.1' })
      .expect(200)
    expect([undefined, '', '192.168.1.2', '::ffff:192.168.1.2', '10.0.0.127'].map(isLoopback)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
    expect(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'].map(isLoopback)).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('ADMIN_ACCESS=any turns the guard off for deployments with their own auth', async () => {
    const { api } = await eventWithDesk({ env: { ADMIN_ACCESS: 'any' } })
    await api().get('/api/apps').set(phone).expect(200)
  })

  it('share-info offers LAN addresses, or PUBLIC_BASE_URL when set, and says whether phones can open pages', async () => {
    const { api } = testServer()
    const info = (await api().get('/api/share-info').expect(200)).body
    expect(info).toMatchObject({ port: 8787, servesWeb: false })
    for (const u of info.baseUrls) expect(u).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8787$/)
    const pub = testServer({ env: { PUBLIC_BASE_URL: 'https://morph.example.org/' } })
    expect((await pub.api().get('/api/share-info')).body.baseUrls).toEqual(['https://morph.example.org'])
  })
})
