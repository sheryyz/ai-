import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { parseConfig } from './config'
import { backupBytes, inspectBackup, restoreCopy } from './services/backup'
import { createFromTemplate, testServer } from './test-utils'

describe('consistent backups and isolated restore', () => {
  it('captures committed WAL records, validates a copy, keeps live changes and invalidates restored sessions/links', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'morphos-backup-test-'))
    const { ctx, api } = testServer({ databasePath: path.join(root, 'live.db') })
    const app = await createFromTemplate(api, 'event-registration', true)
    ctx.db
      .prepare('INSERT INTO view_links(token, app_id, view_id, created_at) VALUES (?, ?, ?, ?)')
      .run('synthetic-link', app.id, 'demo', ctx.now().toISOString())
    const old = ctx.db.prepare('SELECT * FROM records ORDER BY id').all()
    const snapshot = backupBytes(ctx, root)
    expect(snapshot.summary.records).toBe(old.length)
    await api()
      .post(`/api/apps/${app.id}/records`)
      .send({ nodeId: 'signup', values: { name: '新增', studentId: 'N', major: '计算机' } })
      .expect(201)
    const current = ctx.db.prepare('SELECT * FROM records ORDER BY id').all()
    const result = restoreCopy(ctx, snapshot.content, root)
    expect(ctx.db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(current)
    const file = path.join(root, `${result.id}.db`)
    const restored = new DatabaseSync(file)
    expect(restored.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(old)
    expect(restored.prepare('SELECT count(*) AS n FROM admin_sessions WHERE revoked = 0').get()?.n).toBe(0)
    expect(restored.prepare('SELECT count(*) AS n FROM view_links WHERE revoked_at IS NULL').get()?.n).toBe(0)
    expect(inspectBackup(path.join(root, result.safetyBackup)).records).toBe(current.length)
    restored.close()
    // The recovered file can be opened by the real application; data survives another connection.
    const restart = createApp(parseConfig({ NODE_ENV: 'test', DATABASE_PATH: file }))
    expect(restart.ctx.db.prepare('SELECT count(*) AS n FROM records').get()?.n).toBe(old.length)
    await request(restart.app).get('/api/apps').expect(401)
    restart.ctx.db.close()
    ctx.db.close()
  })
  it('rejects non-SQLite and modified schemas before touching the live database', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'morphos-backup-invalid-'))
    const { ctx, api } = testServer()
    await createFromTemplate(api, 'event-registration')
    expect(() => restoreCopy(ctx, Buffer.from('not a database'), root)).toThrow()
    const snapshot = backupBytes(ctx, root)
    const tampered = new DatabaseSync(snapshot.file)
    tampered.exec('CREATE TABLE unexpected (id TEXT)')
    tampered.close()
    expect(() => restoreCopy(ctx, readFileSync(snapshot.file), root)).toThrow(/结构/)
    expect(ctx.db.prepare('SELECT count(*) AS n FROM apps').get()?.n).toBe(1)
    ctx.db.close()
  })
  it('requires an authenticated administrator for backup and restore endpoints', async () => {
    const { app, ctx } = createApp(parseConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }))
    await request(app).post('/api/workspace/backup').set('X-MorphOS-Request', '1').expect(401)
    await request(app).post('/api/workspace/restore').set('X-MorphOS-Request', '1').expect(401)
    ctx.db.close()
  })
})
