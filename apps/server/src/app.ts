import { existsSync } from 'node:fs'
import path from 'node:path'
import { PROTOCOL_VERSION } from '@morphos/shared'
import express, { type ErrorRequestHandler } from 'express'
import { type AppConfig, REPO_ROOT } from './config'

export function createApp(config: AppConfig) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      ai: {
        configured: Boolean(config.llm.apiKey),
        model: config.llm.model,
        provider: new URL(config.llm.baseUrl).host,
      },
    })
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  // Production: serve the built web app from the same port.
  const webDist = path.join(REPO_ROOT, 'apps/web/dist')
  if (config.nodeEnv === 'production' && existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')))
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' ? err.status : 500
    if (status >= 500) console.error(err)
    res.status(status).json({
      error: {
        code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
        message: status === 400 ? '请求格式不正确' : '服务器内部错误',
      },
    })
  }
  app.use(onError)

  return app
}
