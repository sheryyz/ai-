// AC-10: an app built while the model was available keeps working after a restart without LLM_API_KEY.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { StoredRecord } from '@morphos/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO_ROOT } from './config'
import { createFromTemplate, parseStream, resultOf, scripted, testServer } from './test-utils'

const checkinPatch = () => ({
  ...JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/proposals/event-checkin.patch.json'), 'utf8')),
  baseVersion: 1,
})

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('offline mode after a restart without a key (AC-10)', () => {
  it('keeps CRUD, quick actions, filters, export and version history working', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'morphos-'))
    dirs.push(dir)
    const file = path.join(dir, 'offline.db')

    // 1. With a model: create from template, evolve with the check-in patch (adds a Filter + MessageDraft).
    const online = testServer({ databasePath: file, llm: scripted([checkinPatch()]) })
    const app = await createFromTemplate(online.api, 'event-registration', true)
    const plan = await online.api().post('/api/ai/plan').send({ intent: '加签到', appId: app.id }).expect(200)
    const proposal = resultOf(parseStream(plan.text))?.proposal
    await online.api().post(`/api/proposals/${proposal?.id}/approve`).expect(200)
    online.ctx.db.close()

    // 2. Restart on the same database with no key.
    const { api, ctx } = testServer({ databasePath: file })
    try {
      expect((await api().get('/api/health').expect(200)).body.ai.configured).toBe(false)
      const refused = await api()
        .post('/api/ai/plan')
        .send({ intent: '再加一个字段', appId: app.id })
        .expect(503)
      expect(refused.body.error).toMatchObject({ code: 'AI_UNAVAILABLE' })
      expect(refused.body.error.message).toContain('未配置模型')

      const apps = (await api().get('/api/apps').expect(200)).body.apps
      expect(apps).toHaveLength(1)
      expect(apps[0]).toMatchObject({ id: app.id, version: 2, recordCount: 36 })

      // Create, edit and (soft) delete through the runtime components.
      const created = await api()
        .post(`/api/apps/${app.id}/records`)
        .send({ nodeId: 'signup', values: { name: '离线新增', studentId: '2026999', major: '计算机' } })
        .expect(201)
      const rid = created.body.record.id
      expect(created.body.record.values.checkedIn).toBe(false)
      await api()
        .patch(`/api/apps/${app.id}/records/${rid}`)
        .send({ nodeId: 'roster', values: { phone: '13700000000' } })
        .expect(200)

      // Filter: the reminder goes to computer-science attendees who have not checked in.
      const stored = (await api().get(`/api/apps/${app.id}/records`).expect(200)).body
        .records as StoredRecord[]
      const absent = stored.filter((r) => r.data.major === '计算机' && r.data.checkedIn !== true)
      expect(absent.map((r) => r.id)).toContain(rid)
      const before = (await api().post(`/api/apps/${app.id}/outbox`).send({ nodeId: 'remind' }).expect(201))
        .body.entry
      expect(before.recipientCount).toBe(absent.length)

      // Quick action check-in drops the record out of the filter.
      const checked = await api()
        .post(`/api/apps/${app.id}/actions/checkin`)
        .send({ recordId: rid })
        .expect(200)
      expect(checked.body.record.values.checkedIn).toBe(true)
      const after = (await api().post(`/api/apps/${app.id}/outbox`).send({ nodeId: 'remind' }).expect(201))
        .body.entry
      expect(after.recipientCount).toBe(absent.length - 1)
      expect(after.messages.map((m: { recordId: string }) => m.recordId)).not.toContain(rid)

      // CSV export.
      const csv = await api().get(`/api/apps/${app.id}/export.csv?node=exportAll`).expect(200)
      expect(csv.headers['x-record-count']).toBe('37')
      expect(csv.text).toContain('离线新增')

      await api().delete(`/api/apps/${app.id}/records/${rid}?node=roster`).expect(204)
      expect((await api().get(`/api/apps/${app.id}/records`)).body.records).toHaveLength(36)

      // Version history: restore v1 and back to v2 without a key; records never change.
      const records = (await api().get(`/api/apps/${app.id}/records`)).body.records
      const versions = (await api().get(`/api/apps/${app.id}/versions`).expect(200)).body.versions
      expect(versions.map((v: { source: string }) => v.source)).toEqual(['ai', 'template'])
      const v3 = await api()
        .post(`/api/apps/${app.id}/versions/1/restore`)
        .send({ baseVersion: 2 })
        .expect(200)
      expect(v3.body.app.definition.nodes.some((n: { id: string }) => n.id === 'checkin')).toBe(false)
      await api().post(`/api/apps/${app.id}/versions/2/restore`).send({ baseVersion: 3 }).expect(200)
      expect((await api().get(`/api/apps/${app.id}/records`)).body.records).toEqual(records)

      // Demo replays stay available offline (labelled as recorded on the client).
      const recs = (await api().get('/api/recordings').expect(200)).body.recordings
      expect(recs.length).toBeGreaterThan(0)
    } finally {
      ctx.db.close()
    }
  })
})
