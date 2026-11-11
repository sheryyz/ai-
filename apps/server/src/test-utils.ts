// Test-only helpers for API tests (Supertest + in-memory SQLite + fixed clock).
import request from 'supertest'
import { createApp } from './app'
import { parseConfig } from './config'
import type { LlmClient } from './llm/client'

export const FIXED_NOW = new Date('2026-11-11T10:00:00+08:00')

export function testServer(
  opts: { key?: string; databasePath?: string; now?: () => Date; llm?: LlmClient | null } = {},
) {
  const config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: opts.databasePath ?? ':memory:',
    ...(opts.key ? { LLM_API_KEY: opts.key } : {}),
  })
  const { app, ctx } = createApp(config, {
    now: opts.now ?? (() => FIXED_NOW),
    llm: opts.llm ?? null,
    replaySpeed: 0,
  })
  return { app, ctx, api: () => request(app) }
}

export async function createFromTemplate(
  api: () => request.Agent | ReturnType<typeof request>,
  templateId: 'event-registration' | 'equipment-lending',
  withSampleData = false,
) {
  const res = await api().post('/api/apps').send({ templateId, withSampleData }).expect(201)
  return res.body.app as { id: string; version: number; recordCount: number }
}
