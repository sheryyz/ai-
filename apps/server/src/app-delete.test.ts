import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './db'
import { MIGRATIONS } from './db/migrations'
import { createFromTemplate, PEER_HEADER, parseStream, resultOf, scripted, testServer } from './test-utils'

describe('app deletion', () => {
  it('migrates an existing database with apps to active, nullable deletion timestamps', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)')
      for (const m of MIGRATIONS.filter((m) => m.version < 4)) {
        db.exec(m.sql)
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.name, 'old')
      }
      db.prepare('INSERT INTO apps VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'old',
        '旧应用',
        'box',
        1,
        0,
        'old',
        'old',
      )
      migrate(db)
      migrate(db)
      expect(db.prepare('SELECT name, deleted_at FROM apps WHERE id = ?').get('old')).toMatchObject({
        name: '旧应用',
        deleted_at: null,
      })
    } finally {
      db.close()
    }
  })

  it('hides just the deleted app, retains data and versions, and blocks stale entry points', async () => {
    const model = scripted([
      {
        kind: 'patch',
        intent: '改名',
        summary: '改名',
        baseVersion: 1,
        operations: [{ op: 'updateApp', name: '新名称' }],
      },
    ])
    const { api, ctx } = testServer({ llm: model })
    try {
      const app = await createFromTemplate(api, 'event-registration', true)
      const other = await createFromTemplate(api, 'equipment-lending')
      const records = ctx.db.prepare('SELECT * FROM records WHERE app_id = ?').all(app.id)
      const versions = ctx.db.prepare('SELECT * FROM app_versions WHERE app_id = ?').all(app.id)
      const plan = await api().post('/api/ai/plan').send({ appId: app.id, intent: '改名' }).expect(200)
      const proposal = resultOf(parseStream(plan.text))?.proposal
      expect(proposal?.status).toBe('pending')

      await api().delete(`/api/apps/${app.id}`).expect(204)
      await api().delete(`/api/apps/${app.id}`).expect(204)
      expect((await api().get('/api/apps')).body.apps.map((a: { id: string }) => a.id)).toEqual([other.id])
      for (const suffix of ['', '/records', '/versions', '/versions/1', '/proposals', '/outbox', '/views']) {
        const response = await api().get(`/api/apps/${app.id}${suffix}`).expect(410)
        expect(response.body.error.code).toBe('APP_DELETED')
      }
      await api().post(`/api/apps/${app.id}/records`).send({ nodeId: 'signup', values: {} }).expect(410)
      await api().post(`/api/apps/${app.id}/versions/1/restore`).send({ baseVersion: 1 }).expect(410)
      await api().post(`/api/proposals/${proposal?.id}/approve`).send({}).expect(410)
      await api().get(`/api/proposals/${proposal?.id}`).expect(410)
      await api().post('/api/ai/plan').send({ appId: app.id, intent: '继续修改' }).expect(410)
      expect(ctx.db.prepare('SELECT * FROM records WHERE app_id = ?').all(app.id)).toEqual(records)
      expect(ctx.db.prepare('SELECT * FROM app_versions WHERE app_id = ?').all(app.id)).toEqual(versions)
      expect(
        ctx.db.prepare("SELECT * FROM audit_events WHERE app_id = ? AND type = 'app.deleted'").all(app.id),
      ).toHaveLength(1)
      await api().get(`/api/apps/${other.id}`).expect(200)
    } finally {
      ctx.db.close()
    }
  })

  it('requires local admin access and returns 404 for an unknown app', async () => {
    const { api, ctx } = testServer()
    try {
      const app = await createFromTemplate(api, 'event-registration')
      await api().delete(`/api/apps/${app.id}`).set(PEER_HEADER, '192.168.1.9').expect(403)
      await api().get(`/api/apps/${app.id}`).expect(200)
      await api().delete('/api/apps/missing').expect(404)
    } finally {
      ctx.db.close()
    }
  })
})
