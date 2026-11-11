import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/** Repository root (apps/server/src → ../../..). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().min(1).default('./data/morphos.db'),
  LLM_BASE_URL: z.url().default('https://api.deepseek.com'),
  LLM_API_KEY: z.string().trim().optional(),
  LLM_MODEL: z.string().min(1).default('deepseek-flash'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export interface AppConfig {
  port: number
  databasePath: string
  nodeEnv: 'development' | 'production' | 'test'
  llm: {
    baseUrl: string
    model: string
    /** Never sent to the client or written to logs. */
    apiKey: string | undefined
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
    databasePath: path.resolve(REPO_ROOT, e.DATABASE_PATH),
    nodeEnv: e.NODE_ENV,
    llm: {
      baseUrl: e.LLM_BASE_URL.replace(/\/+$/, ''),
      model: e.LLM_MODEL,
      apiKey: e.LLM_API_KEY ? e.LLM_API_KEY : undefined,
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
