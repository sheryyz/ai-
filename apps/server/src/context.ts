import { randomUUID } from 'node:crypto'
import { localDate } from '@morphos/shared'
import type { AppConfig } from './config'
import type { DB } from './db'
import type { LlmClient } from './llm/client'

/** Everything a service needs. Injected so tests can use an in-memory DB and a fixed clock. */
export interface Ctx {
  db: DB
  config: AppConfig
  now: () => Date
  /** Live model client, or null in offline mode (no LLM_API_KEY). */
  llm: LlmClient | null
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/** Today in the configured business time zone, as a filter evaluation context. */
export function evalCtx(ctx: Ctx): { today: string } {
  return { today: localDate(ctx.now(), ctx.config.timeZone) }
}
