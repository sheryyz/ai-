// Test-only helpers for API tests (Supertest + in-memory SQLite + fixed clock).
import type { PlanEvent } from '@morphos/shared'
import request from 'supertest'
import { createApp } from './app'
import { parseConfig } from './config'
import type { ChatMessage, LlmClient } from './llm/client'

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
