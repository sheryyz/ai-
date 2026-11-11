import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { assertNodeVersion, parseConfig } from './config'

describe('GET /api/health', () => {
  it('reports AI as configured without leaking the key', async () => {
    const { app } = createApp(
      parseConfig({ LLM_API_KEY: 'test-secret-key', NODE_ENV: 'test', DATABASE_PATH: ':memory:' }),
    )
    const res = await request(app).get('/api/health').expect(200)
    expect(res.body).toMatchObject({
      ok: true,
      protocolVersion: 1,
      ai: { configured: true, model: 'deepseek-flash', provider: 'api.deepseek.com' },
    })
    expect(JSON.stringify(res.body)).not.toContain('test-secret-key')
  })

  it('reports offline mode when no key is set (AC-10)', async () => {
    const { app } = createApp(parseConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }))
    const res = await request(app).get('/api/health').expect(200)
    expect(res.body.ai.configured).toBe(false)
  })

  it('returns a structured 404 for unknown API routes', async () => {
    const { app } = createApp(parseConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }))
    const res = await request(app).get('/api/nope').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('config', () => {
  it('rejects an invalid base URL with a readable message', () => {
    expect(() => parseConfig({ LLM_BASE_URL: 'not a url' })).toThrow(/环境变量配置无效/)
  })

  it('treats a blank key as not configured', () => {
    expect(parseConfig({ LLM_API_KEY: '   ' }).llm.apiKey).toBeUndefined()
  })

  it('enforces Node >= 22.13 (ADR-0003)', () => {
    expect(() => assertNodeVersion('22.12.0')).toThrow(/22\.13/)
    expect(() => assertNodeVersion('22.13.0')).not.toThrow()
    expect(() => assertNodeVersion('24.21.0')).not.toThrow()
  })
})

describe('time zone config (ADR-0005)', () => {
  it('defaults to Asia/Shanghai and rejects invalid zones', () => {
    expect(parseConfig({}).timeZone).toBe('Asia/Shanghai')
    expect(() => parseConfig({ APP_TIMEZONE: 'Mars/Base' })).toThrow(/IANA/)
  })
})
