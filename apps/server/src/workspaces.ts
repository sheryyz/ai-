import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { type RequestHandler, Router } from 'express'
import { isLoopback, type RemoteAddressOf } from './access'
import {
  account,
  authenticated,
  authRouter,
  Credentials,
  hash,
  requireAdmin,
  session,
  writeGuard,
} from './auth'
import type { Ctx } from './context'
import { openDatabase } from './db'
import { HttpError } from './errors'
import { aiRouter } from './routes/ai'
import { appsRouter } from './routes/apps'
import { guidanceRouter } from './routes/guidance'
import { recordsRouter } from './routes/records'
import { viewsRouter } from './routes/views'
import { workspaceRouter } from './routes/workspace'

/** Each router closes over one immutable database context: no shared mutable current-user state. */
export function workspaceGateway(root: Ctx, remoteAddress: RemoteAddressOf, replaySpeed?: number) {
  const entries: { ctx: Ctx; router: Router }[] = []
  const directory = root.config.databasePath === ':memory:' ? null : `${root.config.databasePath}.workspaces`
  function add(ctx: Ctx) {
    const router = Router()
    router.use('/auth', authRouter(ctx, remoteAddress))
    router.use(requireAdmin(ctx))
    router.use(workspaceRouter(ctx))
    router.use(viewsRouter(ctx))
    router.use(appsRouter(ctx))
    router.use(recordsRouter(ctx))
    router.use(aiRouter(ctx, { replaySpeed }))
    router.use(guidanceRouter(ctx))
    const entry = { ctx, router }
    entries.push(entry)
    return entry
  }
  const original = add(root)
  if (directory && existsSync(directory)) {
    for (const filename of readdirSync(directory)) {
      if (!/^workspace_[a-f0-9]{32}\.db$/.test(filename)) continue
      const databasePath = path.join(directory, filename)
      const db = openDatabase(databasePath)
      if (!account({ ...root, db })) {
        db.close()
        continue
      }
      add({ ...root, db, config: { ...root.config, databasePath } })
    }
  }
  const byName = (name: string) => entries.find((entry) => account(entry.ctx)?.username === name)
  const pending = new Set<string>()
  const attempts = new Map<string, { count: number; until: number }>()
  const gateway = Router()
  const register: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const firstOnly = req.path.replace(/\/+$/, '') === '/auth/setup'
    if (firstOnly && !isLoopback(remoteAddress(req)))
      throw new HttpError(403, 'SETUP_LOCAL_ONLY', '原工作区首次设置请在本机完成；其他设备请注册新工作区')
    if (firstOnly && account(root))
      throw new HttpError(409, 'ADMIN_EXISTS', '工作区已设置，请登录或注册新工作区')
    const parsed = Credentials.safeParse(req.body)
    if (!parsed.success)
      throw new HttpError(422, 'CREDENTIALS_INVALID', '账号需为 1–64 个字符，密码需为 12–128 个字符')
    const { username, password } = parsed.data
    const now = root.now().getTime()
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key)
    const peer = remoteAddress(req) ?? 'unknown'
    const limit = attempts.get(peer)
    if ((limit && limit.count >= 8) || pending.size >= 4 || (!limit && attempts.size >= 1000)) {
      res.setHeader('Retry-After', '900')
      throw new HttpError(429, 'REGISTER_LIMIT', '注册请求过多，请稍后再试')
    }
    attempts.set(peer, { count: (limit?.count ?? 0) + 1, until: limit?.until ?? now + 900000 })
    if (byName(username) || pending.has(username))
      throw new HttpError(409, 'USERNAME_EXISTS', '此账号已注册，请登录或使用其他账号名')
    pending.add(username)
    try {
      const salt = randomBytes(16).toString('hex')
      const passwordHash = await hash(password, salt)
      // No await between rechecking identity, choosing a database and committing the account.
      if (byName(username)) throw new HttpError(409, 'USERNAME_EXISTS', '此账号已注册，请使用其他账号名')
      if (firstOnly && account(root))
        throw new HttpError(409, 'ADMIN_EXISTS', '工作区已设置，请登录或注册新工作区')
      let entry = original
      if (account(root) || !isLoopback(remoteAddress(req))) {
        let databasePath = ':memory:'
        if (directory) {
          mkdirSync(directory, { recursive: true, mode: 0o700 })
          databasePath = path.join(directory, `workspace_${randomUUID().replaceAll('-', '')}.db`)
        }
        const db = openDatabase(databasePath)
        if (directory) chmodSync(databasePath, 0o600)
        entry = add({ ...root, db, config: { ...root.config, databasePath } })
      }
      entry.ctx.db
        .prepare('INSERT INTO admin_account VALUES (1, ?, ?, ?)')
        .run(username, passwordHash.toString('hex'), salt)
      session(entry.ctx, req, res)
      res.status(201).json({ ok: true })
    } finally {
      pending.delete(username)
    }
  }
  gateway.post(['/auth/register', '/auth/setup'], writeGuard, register)
  gateway.use((req, res, next) => {
    let entry = original
    if (req.path.startsWith('/v/')) {
      const token = req.path.split('/')[2] ?? ''
      entry =
        entries.find((item) => item.ctx.db.prepare('SELECT 1 FROM view_links WHERE token = ?').get(token)) ??
        original
    } else if (req.path === '/auth/login') {
      const parsed = Credentials.safeParse(req.body)
      const found = parsed.success ? byName(parsed.data.username) : undefined
      if (!found) throw new HttpError(401, 'LOGIN_FAILED', '账号或密码不正确')
      entry = found
    } else {
      entry = entries.find((item) => authenticated(item.ctx, req)) ?? original
    }
    entry.router(req, res, next)
  })
  return {
    router: gateway,
    /** Call when the server shuts down. The original DB remains owned by createApp's caller. */
    close: () => {
      for (const entry of entries.slice(1)) entry.ctx.db.close()
    },
  }
}
