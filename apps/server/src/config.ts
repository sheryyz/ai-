import { existsSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@morphos/shared'
import { z } from 'zod'

/** Repository root (apps/server/src → ../../..). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const WEB_DIST = path.join(REPO_ROOT, 'apps/web/dist')

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().min(1).default('./data/morphos.db'),
  LLM_BASE_URL: z.url().default('https://api.deepseek.com'),
  LLM_API_KEY: z.string().trim().optional(),
  LLM_MODEL: z.string().min(1).default('deepseek-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  LLM_MAX_TOKENS: z.coerce.number().int().min(1_000).max(64_000).default(16_000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  APP_TIMEZONE: z
    .string()
    .default(DEFAULT_TIME_ZONE)
    .refine(isValidTimeZone, { error: '不是有效的 IANA 时区，例如 Asia/Shanghai' }),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_ACCESS: z.enum(['local', 'any']).default('local'),
  PUBLIC_BASE_URL: z.url().optional(),
})

export interface AppConfig {
  port: number
  databasePath: string
  nodeEnv: 'development' | 'production' | 'test'
  /** Business time zone for "today", $today and timestamps (ADR-0005). */
  timeZone: string
  /** ADR-0008: 'local' = admin API only from loopback; 'any' only behind your own auth. */
  adminAccess: 'local' | 'any'
  /** Overrides the LAN addresses offered for share links (e.g. a tunnel or deployed URL). */
  publicBaseUrl: string | undefined
  llm: {
    baseUrl: string
    model: string
    /** Never sent to the client or written to logs. */
    apiKey: string | undefined
    timeoutMs: number
    maxTokens: number
    temperature: number
  }
}

/** Loads the repo-root .env (if present) without overriding variables already set. */
export function loadEnvFile(file = path.join(REPO_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file)
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = EnvSchema.safeParse(env)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`环境变量配置无效：${detail}`)
  }
  const e = result.data
  return {
    port: e.PORT,
    databasePath: e.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(REPO_ROOT, e.DATABASE_PATH),
    nodeEnv: e.NODE_ENV,
    timeZone: e.APP_TIMEZONE,
    adminAccess: e.ADMIN_ACCESS,
    publicBaseUrl: e.PUBLIC_BASE_URL?.replace(/\/+$/, ''),
    llm: {
      baseUrl: e.LLM_BASE_URL.replace(/\/+$/, ''),
      model: e.LLM_MODEL,
      apiKey: e.LLM_API_KEY ? e.LLM_API_KEY : undefined,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxTokens: e.LLM_MAX_TOKENS,
      temperature: e.LLM_TEMPERATURE,
    },
  }
}

const MIN_NODE = [22, 13] as const

/** ADR-0003: node:sqlite requires Node >= 22.13 without flags. */
export function assertNodeVersion(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])
  if (!ok) {
    throw new Error(`MorphOS 需要 Node.js ≥ ${MIN_NODE.join('.')}，当前为 ${version}。请升级后重试。`)
  }
}
