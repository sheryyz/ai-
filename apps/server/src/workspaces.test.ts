import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { parseConfig } from './config'
import { createApp as createStoredApp } from './services/apps'
import { getTemplate } from './services/templates'
import { parseStream, resultOf } from './test-utils'

const password = 'workspace-test-password-2026'
const config = (databasePath = ':memory:') => parseConfig({ NODE_ENV: 'test', DATABASE_PATH: databasePath })

describe('independent workspaces', () => {
  it('isolates apps, records, proposals, controls and backups while routing public share tokens', async () => {
    const instance = createApp(config(), { replaySpeed: 0 })
    const { app } = instance
    const alice = request.agent(app).set('X-MorphOS-Request', '1')
    const bob = request.agent(app).set('X-MorphOS-Request', '1')
    try {
      await request(app).post('/api/auth/register').send({ username: 'alice', password }).expect(403)
      await alice.post('/api/auth/register').send({ username: 'alice', password }).expect(201)
      const a = (
        await alice
          .post('/api/apps')
          .send({ templateId: 'event-registration', withSampleData: true })
          .expect(201)
      ).body.app
      await bob.post('/api/auth/register').send({ username: 'bob', password }).expect(201)
      expect((await bob.get('/api/apps').expect(200)).body.apps).toEqual([])
      for (const suffix of ['', '/records', '/versions', '/constraints', '/phases', '/views'])
        await bob.get(`/api/apps/${a.id}${suffix}`).expect(404)
      await bob.delete(`/api/apps/${a.id}`).expect(404)
      await bob.patch(`/api/apps/${a.id}`).send({ baseVersion: 1, name: 'stolen' }).expect(404)
      const stream = await alice.post('/api/ai/plan').send({ recordingId: '01-event-create' }).expect(200)
      const proposal = resultOf(parseStream(stream.text))?.proposal
      expect(proposal).toBeDefined()
      await bob.get(`/api/proposals/${proposal?.id}`).expect(404)
      await bob.post(`/api/proposals/${proposal?.id}/approve`).send({}).expect(404)
      await bob.post(`/api/proposals/${proposal?.id}/reject`).send({}).expect(404)
      // New-workspace generation/approval and public shares use the new DB, not the original.
      const ownStream = await bob.post('/api/ai/plan').send({ recordingId: '01-event-create' }).expect(200)
      const ownProposal = resultOf(parseStream(ownStream.text))?.proposal
      const created = (await bob.post(`/api/proposals/${ownProposal?.id}/approve`).send({}).expect(200)).body
        .app
      const viewStream = await bob
        .post('/api/ai/plan')
        .send({ recordingId: '06-event-signup-page', appId: created.id })
        .expect(200)
      const viewProposal = resultOf(parseStream(viewStream.text))?.proposal
      await bob.post(`/api/proposals/${viewProposal?.id}/approve`).send({}).expect(200)
      const views = (await bob.get(`/api/apps/${created.id}/views`).expect(200)).body.views
      const viewId = views[0].viewId
      const share = (await bob.post(`/api/apps/${created.id}/views/${viewId}/link`).send({}).expect(200)).body
        .token
      await request(app).get(`/api/v/${share}`).expect(200)
      await alice.get(`/api/apps/${created.id}`).expect(404)
      // Backup has only Bob's account and app, not Alice's records or credentials.
      const backup = await bob.post('/api/workspace/backup').expect(200)
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'morphos-isolation-')), 'bob.db')
      writeFileSync(file, backup.body)
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        expect(db.prepare('SELECT username FROM admin_account').get()?.username).toBe('bob')
        expect(db.prepare('SELECT id FROM apps').all()).toEqual([{ id: created.id }])
        expect(db.prepare('SELECT count(*) AS n FROM records').get()?.n).toBe(0)
      } finally {
        db.close()
      }
      await bob
        .post('/api/auth/password')
        .send({ currentPassword: password, newPassword: 'bob-new-password-2026' })
        .expect(200)
      await bob.get('/api/apps').expect(401)
      await alice.get(`/api/apps/${a.id}`).expect(200)
      await bob
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'bob-new-password-2026' })
        .expect(200)
      await bob.get(`/api/apps/${created.id}`).expect(200)
    } finally {
      instance.closeWorkspaces()
      instance.ctx.db.close()
    }
  })

  it('preserves the original workspace and loads new accounts and sessions after a disk restart', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'morphos-workspaces-')), 'original.db')
    const first = createApp(config(file))
    const original = request.agent(first.app).set('X-MorphOS-Request', '1')
    await original.post('/api/auth/setup').send({ username: 'existing-owner', password }).expect(201)
    const oldApp = (await original.post('/api/apps').send({ templateId: 'event-registration' }).expect(201))
      .body.app
    const fresh = request.agent(first.app).set('X-MorphOS-Request', '1')
    const registered = await fresh
      .post('/api/auth/register')
      .send({ username: 'new-owner', password })
      .expect(201)
    const cookie = registered.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
    const newApp = (await fresh.post('/api/apps').send({ templateId: 'equipment-lending' }).expect(201)).body
      .app
    first.closeWorkspaces()
    first.ctx.db.close()
    const second = createApp(config(file))
    try {
      const resumed = request.agent(second.app).set('X-MorphOS-Request', '1').set('Cookie', cookie)
      expect((await resumed.get('/api/auth/status')).body.username).toBe('new-owner')
      await resumed.get(`/api/apps/${newApp.id}`).expect(200)
      await resumed.get(`/api/apps/${oldApp.id}`).expect(404)
      await resumed.post('/api/auth/logout').expect(204)
      await resumed.post('/api/auth/login').send({ username: 'existing-owner', password }).expect(200)
      await resumed.get(`/api/apps/${oldApp.id}`).expect(200)
      await resumed.get(`/api/apps/${newApp.id}`).expect(404)
      await resumed.post('/api/auth/register').send({ username: 'new-owner', password }).expect(409)
    } finally {
      second.closeWorkspaces()
      second.ctx.db.close()
    }
  })

  it('allows network registration, rejects invalid and concurrent duplicate accounts, and bounds registration attempts', async () => {
    const instance = createApp(config(), { remoteAddress: () => '192.168.1.8' })
    const legacy = createStoredApp(instance.ctx, getTemplate('event-registration').info.definition, {
      source: 'template',
    })
    const agent = () => request.agent(instance.app).set('X-MorphOS-Request', '1')
    try {
      await agent().get('/api/auth/status').expect(200)
      await agent().post('/api/auth/register').send({ username: 'x', password: 'short' }).expect(422)
      const results = await Promise.all(
        [agent(), agent()].map((a) => a.post('/api/auth/register').send({ username: 'same', password })),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409])
      const cookie = results.find((r) => r.status === 201)?.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
      const remote = agent().set('Cookie', cookie)
      expect((await remote.get('/api/apps').expect(200)).body.apps).toEqual([])
      await remote.get(`/api/apps/${legacy.id}`).expect(404)
      expect(instance.ctx.db.prepare('SELECT count(*) AS n FROM admin_account').get()?.n).toBe(0)
      await agent().post('/api/auth/setup').send({ username: 'claim-legacy', password }).expect(403)
      for (let i = 0; i < 6; i++)
        await agent().post('/api/auth/register').send({ username: 'same', password }).expect(409)
      await agent().post('/api/auth/register').send({ username: 'different', password }).expect(429)
    } finally {
      instance.closeWorkspaces()
      instance.ctx.db.close()
    }
  })
})
