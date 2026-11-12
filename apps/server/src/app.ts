import { existsSync } from 'node:fs'
import path from 'node:path'
import { type HealthInfo, PROTOCOL_VERSION } from '@morphos/shared'
import express, { type ErrorRequestHandler } from 'express'
import { type AppConfig, WEB_DIST } from './config'
import type { Ctx } from './context'
import { type DB, openDatabase } from './db'
import { HttpError } from './errors'
import { createLiveClient, type LlmClient } from './llm/client'
import { aiRouter } from './routes/ai'
import { appsRouter } from './routes/apps'
import { recordsRouter } from './routes/records'
import { viewsRouter } from './routes/views'

export interface AppDeps {
  db?: DB
  now?: () => Date
  /** Injected model client (tests use a scripted fake); defaults to the live client when a key is set. */
  llm?: LlmClient | null
  /** Replay pacing for recorded demos: 1 = a few seconds, 0 = instant (tests). */
  replaySpeed?: number
}

export function createApp(config: AppConfig, deps: AppDeps = {}) {
  const ctx: Ctx = {
    db: deps.db ?? openDatabase(config.databasePath),
    config,
    now: deps.now ?? (() => new Date()),
    llm:
      deps.llm !== undefined
        ? deps.llm
        : config.llm.apiKey
          ? createLiveClient({ ...config.llm, apiKey: config.llm.apiKey })
          : null,
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    const health: HealthInfo = {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      timeZone: config.timeZone,
      ai: {
        configured: Boolean(config.llm.apiKey),
        model: config.llm.model,
        provider: new URL(config.llm.baseUrl).host,
      },
    }
    res.json(health)
  })

  app.use('/api', viewsRouter(ctx))
  app.use('/api', appsRouter(ctx))
  app.use('/api', recordsRouter(ctx))
  app.use('/api', aiRouter(ctx, { replaySpeed: deps.replaySpeed }))

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  // Production: serve the built web app from the same port.
  if (config.nodeEnv === 'production' && existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')))
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      })
      return
    }
    const status = typeof err?.status === 'number' ? err.status : 500
    if (status >= 500) console.error(err)
    const isJson = err?.type === 'entity.parse.failed'
    res.status(status).json({
      error: {
        code: status === 400 ? 'BAD_REQUEST' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
        message: isJson ? '请求体不是合法的 JSON' : status < 500 ? '请求格式不正确' : '服务器内部错误',
      },
    })
  }
  app.use(onError)

  return { app, ctx }
}
