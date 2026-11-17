import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { parseConfig } from './config'

const credentials = { username: 'owner', password: 'correct-horse-battery-123' }
const config = () => parseConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', ADMIN_ACCESS: 'local' })
describe('single administrator authentication', () => {
  it('protects existing apps, hashes secrets, persists sessions, revokes logout and expires sessions', async () => {
    let now = new Date('2026-11-14T00:00:00Z')
    const { app, ctx } = createApp(config(), { now: () => now })
    const guest = request(app)
    expect((await guest.get('/api/auth/status')).body.setupRequired).toBe(true)
    await guest.get('/api/apps').expect(401)
    await guest.post('/api/auth/setup').send(credentials).expect(403)
    await guest
      .post('/api/auth/setup')
      .set('X-MorphOS-Request', '1')
      .send({ ...credentials, password: 'short' })
      .expect(422)
    const setup = await guest
      .post('/api/auth/setup')
      .set('X-MorphOS-Request', '1')
      .send(credentials)
      .expect(201)
    const cookie = (setup.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''
    expect(setup.headers['set-cookie']?.[0]).toMatch(/HttpOnly/)
    expect(setup.headers['set-cookie']?.[0]).toMatch(/SameSite=Strict/)
    const agent = request.agent(app).set('Cookie', cookie).set('X-MorphOS-Request', '1')
    await agent.get('/api/apps').expect(200)
    await agent.post('/api/auth/setup').send(credentials).expect(409)
    const created = await agent.post('/api/apps').send({ templateId: 'event-registration' }).expect(201)
    const rows = ctx.db.prepare('SELECT * FROM admin_account').all()
    expect(JSON.stringify(rows)).not.toContain(credentials.password)
    expect(JSON.stringify(ctx.db.prepare('SELECT * FROM admin_sessions').all())).not.toContain(
      cookie.split('=')[1],
    )
    // A recreated server using the same database still accepts the session.
    const restarted = createApp(config(), { db: ctx.db, now: () => now })
    await request(restarted.app).get('/api/apps').set('Cookie', cookie).expect(200)
    await agent.post('/api/auth/logout').expect(204)
    await agent.get(`/api/apps/${created.body.app.id}`).expect(401)
    await agent
      .post('/api/auth/login')
      .send({ ...credentials, password: 'incorrect-password' })
      .expect(401)
    const login = await agent.post('/api/auth/login').send(credentials).expect(200)
    const nextCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''
    expect(nextCookie).not.toBe(cookie)
    now = new Date(now.getTime() + 13 * 3600000)
    await request(app).get('/api/apps').set('Cookie', nextCookie).expect(401)
    expect(ctx.db.prepare('SELECT count(*) AS n FROM apps').get()?.n).toBe(1)
    ctx.db.close()
  })
  it('keeps public shares accessible, restricts LAN admin and limits login attempts', async () => {
    const { app, ctx } = createApp(config(), { remoteAddress: (req) => req.get('x-peer') ?? '127.0.0.1' })
    const agent = request.agent(app).set('X-MorphOS-Request', '1')
    await agent.get('/api/auth/status').set('x-peer', '192.168.1.8').expect(403)
    await agent.get('/api/v/missing').set('x-peer', '192.168.1.8').expect(404)
    await agent.post('/api/auth/setup').send(credentials).expect(201)
    for (let n = 0; n < 8; n++)
      await agent
        .post('/api/auth/login')
        .send({ ...credentials, password: 'wrong-password-123' })
        .expect(401)
    const limited = await agent.post('/api/auth/login').send(credentials).expect(429)
    expect(limited.headers['retry-after']).toBeDefined()
    ctx.db.close()
  })
  it('changes password only after current-password verification and revokes all sessions', async () => {
    const { app, ctx } = createApp(config())
    const first = request.agent(app).set('X-MorphOS-Request', '1')
    const second = request.agent(app).set('X-MorphOS-Request', '1')
    await first.post('/api/auth/setup').send(credentials).expect(201)
    await second.post('/api/auth/login').send(credentials).expect(200)
    const newPassword = 'new-owner-password-2026'
    await first.post('/api/auth/password').send({ currentPassword: 'incorrect', newPassword }).expect(403)
    await first.get('/api/apps').expect(200)
    await first
      .post('/api/auth/password')
      .send({ currentPassword: credentials.password, newPassword })
      .expect(200)
    await first.get('/api/apps').expect(401)
    await second.get('/api/apps').expect(401)
    await first.post('/api/auth/login').send(credentials).expect(401)
    await first
      .post('/api/auth/login')
      .send({ ...credentials, password: newPassword })
      .expect(200)
    expect(JSON.stringify(ctx.db.prepare('SELECT * FROM admin_account').all())).not.toContain(newPassword)
    ctx.db.close()
  })
  it('does not issue a session if the password changes during an in-flight login', async () => {
    const { app, ctx } = createApp(config())
    const agent = request.agent(app).set('X-MorphOS-Request', '1')
    await agent.post('/api/auth/setup').send(credentials).expect(201)
    const before = ctx.db.prepare('SELECT count(*) AS n FROM admin_sessions').get()?.n
    const pending = agent
      .post('/api/auth/login')
      .send(credentials)
      .then((res) => res)
    for (let n = 0; n < 200 && !ctx.db.prepare('SELECT 1 FROM admin_login_limit').get(); n++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(ctx.db.prepare('SELECT attempts FROM admin_login_limit').get()?.attempts).toBe(1)
    // Simulate another verified password-change request committing while scrypt is awaiting.
    ctx.db.prepare('UPDATE admin_account SET password_hash = ? WHERE id = 1').run('00'.repeat(64))
    expect((await pending).status).toBe(401)
    expect(ctx.db.prepare('SELECT count(*) AS n FROM admin_sessions').get()?.n).toBe(before)
    ctx.db.close()
  })
})
