import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFromTemplate, testServer } from './test-utils'

describe('templates and app hub', () => {
  it('lists both built-in templates', async () => {
    const { api } = testServer()
    const res = await api().get('/api/templates').expect(200)
    expect(res.body.templates.map((t: { id: string }) => t.id)).toEqual([
      'event-registration',
      'equipment-lending',
    ])
  })

  it('AC-04: creates two different apps from the same engine and lists them', async () => {
    const { api } = testServer()
    await createFromTemplate(api, 'event-registration', true)
    await createFromTemplate(api, 'equipment-lending', true)
    const res = await api().get('/api/apps').expect(200)
    expect(res.body.apps).toHaveLength(2)
    expect(res.body.apps.map((a: { recordCount: number }) => a.recordCount).sort()).toEqual([14, 36])
    expect(res.body.apps[0]).toMatchObject({ version: 1, hasSampleData: true })
  })

  it('returns structured errors for unknown templates and apps', async () => {
    const { api } = testServer()
    const a = await api().post('/api/apps').send({ templateId: 'nope' }).expect(404)
    expect(a.body.error.code).toBe('NOT_FOUND')
    const b = await api().get('/api/apps/app_missing').expect(404)
    expect(b.body.error.message).toBe('应用不存在')
  })
})

describe('records', () => {
  it('creates via a form, validates against the schema and reports field errors', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'event-registration')
    const ok = await api()
      .post(`/api/apps/${app.id}/records`)
      .send({ nodeId: 'signup', values: { name: '张三', studentId: '2024001', major: '计算机' } })
      .expect(201)
    expect(ok.body.record.values).toMatchObject({ name: '张三', major: '计算机', phone: null })

    const bad = await api()
      .post(`/api/apps/${app.id}/records`)
      .send({ nodeId: 'signup', values: { name: '', major: '物理' } })
      .expect(422)
    expect(bad.body.error.code).toBe('RECORD_INVALID')
    expect(bad.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'major',
      'name',
      'studentId',
    ])
  })

  it('only accepts fields exposed by the submitting form', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'equipment-lending')
    const res = await api()
      .post(`/api/apps/${app.id}/records`)
      .send({
        nodeId: 'register',
        values: { name: '示波器', code: 'X', category: '示波器', status: '已借出' },
      })
      .expect(422)
    expect(res.body.error.message).toContain('status')
  })

  it('AC-02: records survive a server restart on the same database file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'morphos-'))
    const file = path.join(dir, 'test.db')
    try {
      const first = testServer({ databasePath: file })
      const app = await createFromTemplate(first.api, 'event-registration')
      await first
        .api()
        .post(`/api/apps/${app.id}/records`)
        .send({
          nodeId: 'signup',
          values: { name: '李四', studentId: '2024002', major: '数学', phone: '13800000000' },
        })
        .expect(201)
      first.ctx.db.close()

      const second = testServer({ databasePath: file })
      const res = await second.api().get(`/api/apps/${app.id}/records`).expect(200)
      expect(res.body.records).toHaveLength(1)
      expect(res.body.records[0].data).toEqual({
        name: '李四',
        studentId: '2024002',
        major: '数学',
        phone: '13800000000',
      })
      second.ctx.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('edits through an editable table and soft-deletes only where allowed', async () => {
    const { api, ctx } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    const { body } = await api().get(`/api/apps/${app.id}/records`)
    const id = body.records[0].id
    const upd = await api()
      .patch(`/api/apps/${app.id}/records/${id}`)
      .send({ nodeId: 'roster', values: { phone: '13900000000' } })
      .expect(200)
    expect(upd.body.record.values.phone).toBe('13900000000')

    await api().delete(`/api/apps/${app.id}/records/${id}?node=roster`).expect(204)
    const after = await api().get(`/api/apps/${app.id}/records`)
    expect(after.body.records).toHaveLength(35)
    // Soft delete: the row is still in the database.
    const raw = ctx.db.prepare('SELECT deleted_at FROM records WHERE id = ?').get(id) as {
      deleted_at: string
    }
    expect(raw.deleted_at).toBeTruthy()

    const eq = await createFromTemplate(api, 'equipment-lending', true)
    const eqRecs = await api().get(`/api/apps/${eq.id}/records`)
    const del = await api()
      .delete(`/api/apps/${eq.id}/records/${eqRecs.body.records[0].id}?node=inventory`)
      .expect(403)
    expect(del.body.error.code).toBe('DELETE_NOT_ALLOWED')
  })

  it('storage layer forbids hard deletes and version rewrites (defense in depth)', async () => {
    const { api, ctx } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    expect(() => ctx.db.prepare('DELETE FROM records WHERE app_id = ?').run(app.id)).toThrow(
      /soft-deleted only/,
    )
    expect(() =>
      ctx.db.prepare('UPDATE app_versions SET definition_json = ? WHERE app_id = ?').run('{}', app.id),
    ).toThrow(/append-only/)
  })
})

describe('quick actions (equipment lending)', () => {
  it('lends and returns a device; enforces availableWhen and ask fields', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'equipment-lending', true)
    const recs = (await api().get(`/api/apps/${app.id}/records`)).body.records as {
      id: string
      data: Record<string, unknown>
    }[]
    const free = recs.find((r) => r.data.code === 'OSC-02')!

    const missing = await api()
      .post(`/api/apps/${app.id}/actions/lend`)
      .send({ recordId: free.id })
      .expect(422)
    expect(missing.body.error.message).toContain('借用人')

    const lent = await api()
      .post(`/api/apps/${app.id}/actions/lend`)
      .send({ recordId: free.id, answers: { borrower: '赵老师' } })
      .expect(200)
    expect(lent.body.record.values).toMatchObject({
      status: '已借出',
      borrower: '赵老师',
      borrowedAt: '2026-11-11',
    })

    const again = await api()
      .post(`/api/apps/${app.id}/actions/lend`)
      .send({ recordId: free.id, answers: { borrower: '钱同学' } })
      .expect(409)
    expect(again.body.error.code).toBe('ACTION_NOT_AVAILABLE')

    const back = await api()
      .post(`/api/apps/${app.id}/actions/giveBack`)
      .send({ recordId: free.id })
      .expect(200)
    expect(back.body.record.values).toMatchObject({ status: '可借用', borrower: null, borrowedAt: null })
  })

  it('resolves sample dates relative to the import day', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'equipment-lending', true)
    const recs = (await api().get(`/api/apps/${app.id}/records`)).body.records as {
      data: Record<string, unknown>
    }[]
    expect(recs.find((r) => r.data.code === 'OSC-01')?.data.borrowedAt).toBe('2026-11-01')
  })
})

describe('CSV export (AC-11)', () => {
  it('exports exactly the records flowing into the node, with BOM and Chinese headers', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    const res = await api().get(`/api/apps/${app.id}/export.csv?node=exportAll`).expect(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['x-record-count']).toBe('36')
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('讲座报名名单.csv'))
    expect(res.text.startsWith('﻿姓名,学号,专业,手机号,创建时间')).toBe(true)
    expect(res.text.trim().split('\r\n')).toHaveLength(37)
  })
})

describe('versions', () => {
  it('renames through the validated patch path and restores without touching records (AC-09 storage)', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    const renamed = await api()
      .patch(`/api/apps/${app.id}`)
      .send({ baseVersion: 1, name: '人工智能讲座' })
      .expect(200)
    expect(renamed.body).toMatchObject({ version: 2, app: { name: '人工智能讲座' } })

    const stale = await api().patch(`/api/apps/${app.id}`).send({ baseVersion: 1, name: '冲突' }).expect(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')

    const before = (await api().get(`/api/apps/${app.id}/records`)).body.records
    const preview = await api().get(`/api/apps/${app.id}/versions/1/diff`).expect(200)
    expect(preview.body.diff.app.changed).toEqual(['name'])

    const restored = await api()
      .post(`/api/apps/${app.id}/versions/1/restore`)
      .send({ baseVersion: 2 })
      .expect(200)
    expect(restored.body).toMatchObject({ version: 3, app: { name: '校园讲座报名' } })
    expect((await api().get(`/api/apps/${app.id}/records`)).body.records).toEqual(before)

    const versions = (await api().get(`/api/apps/${app.id}/versions`)).body.versions
    expect(versions.map((v: { version: number; source: string }) => [v.version, v.source])).toEqual([
      [3, 'restore'],
      [2, 'manual'],
      [1, 'template'],
    ])
    expect(versions[0].restoredFrom).toBe(1)
  })
})

describe('simulated outbox', () => {
  it('requires recipients and never claims a real channel', async () => {
    const { api } = testServer()
    const app = await createFromTemplate(api, 'event-registration', true)
    const res = await api().post(`/api/apps/${app.id}/outbox`).send({ nodeId: 'roster' }).expect(404)
    expect(res.body.error.code).toBe('NODE_NOT_FOUND')
  })
})

afterAll(() => undefined)
