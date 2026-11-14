import { createHash, randomBytes } from 'node:crypto'
// Test-only helpers for API tests (Supertest + in-memory SQLite + fixed clock).
import type { PlanEvent } from '@morphos/shared'
import request from 'supertest'
import { createApp } from './app'
import { parseConfig } from './config'
import type { ChatMessage, LlmClient } from './llm/client'

export const FIXED_NOW = new Date('2026-11-11T10:00:00+08:00')

/** Requests carrying this header act as if they came from that address (another device on the LAN). */
export const PEER_HEADER = 'x-test-peer'

export function testServer(
  opts: {
    key?: string
    databasePath?: string
    now?: () => Date
    llm?: LlmClient | null
    env?: Record<string, string>
  } = {},
) {
  const config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: opts.databasePath ?? ':memory:',
    ...(opts.key ? { LLM_API_KEY: opts.key } : {}),
    ...opts.env,
  })
  const { app, ctx } = createApp(config, {
    now: opts.now ?? (() => FIXED_NOW),
    llm: opts.llm ?? null,
    replaySpeed: 0,
    remoteAddress: (req) => req.header(PEER_HEADER) ?? req.socket.remoteAddress,
  })
  // Seed an authenticated session for domain tests; auth.test.ts exercises real setup/login separately.
  const token = randomBytes(32).toString('hex')
  ctx.db
    .prepare('INSERT OR IGNORE INTO admin_account VALUES (1, ?, ?, ?)')
    .run('test-admin', 'test-only', 'test-only')
  ctx.db
    .prepare('INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), ctx.now().getTime() + 86400000)
  return {
    app,
    ctx,
    api: () => request.agent(app).set('Cookie', `morphos_session=${token}`).set('X-MorphOS-Request', '1'),
  }
}

export async function createFromTemplate(
  api: () => request.Agent | ReturnType<typeof request>,
  templateId: 'event-registration' | 'equipment-lending',
  withSampleData = false,
) {
  const res = await api().post('/api/apps').send({ templateId, withSampleData }).expect(201)
  return res.body.app as { id: string; version: number; recordCount: number }
}

/** A scripted stand-in for the model: returns the given outputs in order and records every request. */
export function scripted(outputs: (string | object)[]): LlmClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  return {
    model: 'scripted-test-model',
    origin: 'live',
    temperature: 0,
    calls,
    async chat(messages, opts) {
      calls.push(messages)
      const next = outputs[calls.length - 1]
      if (next === undefined) throw new Error('scripted model ran out of outputs')
      const content = typeof next === 'string' ? next : JSON.stringify(next)
      opts.onReasoning?.('先理解需求，')
      opts.onReasoning?.('再规划组件。')
      opts.onContent?.(content)
      return {
        content,
        reasoning: '先理解需求，再规划组件。',
        usage: null,
        model: 'scripted-test-model',
        finishReason: 'stop',
      }
    },
  }
}

export function parseStream(text: string): PlanEvent[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PlanEvent)
}

export const resultOf = (events: PlanEvent[]) =>
  events.find((e): e is Extract<PlanEvent, { type: 'result' }> => e.type === 'result')
