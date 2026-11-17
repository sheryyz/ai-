import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { type Request, type RequestHandler, type Response, Router } from 'express'
import { z } from 'zod'
import { isLoopback, type RemoteAddressOf } from './access'
import type { Ctx } from './context'
import { tx } from './db'
import { HttpError } from './errors'

const COOKIE = 'morphos_session'
const HOURS = 12 * 60 * 60 * 1000
export const Credentials = z
  .object({ username: z.string().trim().min(1).max(64), password: z.string().min(12).max(128) })
  .strict()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function token(req: Request) {
  return (
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? ''
  )
}
export function account(ctx: Ctx) {
  return ctx.db.prepare('SELECT username, password_hash, salt FROM admin_account WHERE id = 1').get() as
    | { username: string; password_hash: string; salt: string }
    | undefined
}
export function authenticated(ctx: Ctx, req: Request) {
  return Boolean(
    ctx.db
      .prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ? AND revoked = 0')
      .get(digest(token(req)), ctx.now().getTime()),
  )
}
export function hash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  )
}
export function session(ctx: Ctx, req: Request, res: Response) {
  const value = randomBytes(32).toString('hex')
  ctx.db
    .prepare('INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)')
    .run(digest(value), ctx.now().getTime() + HOURS)
  res.cookie(COOKIE, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
    maxAge: HOURS,
  })
}
/** Custom header forces cross-origin browser writes through a CORS preflight; this app grants no CORS access. */
export const writeGuard: RequestHandler = (req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-MorphOS-Request') !== '1') {
    throw new HttpError(403, 'REQUEST_ORIGIN', '请求验证失败，请刷新页面后重试')
  }
  next()
}
function consumePasswordAttempt(ctx: Ctx, res: Response) {
  const now = ctx.now().getTime()
  const limit = ctx.db.prepare('SELECT attempts, reset_at FROM admin_login_limit WHERE id = 1').get() as
    | { attempts: number; reset_at: number }
    | undefined
  if (limit && limit.reset_at > now && limit.attempts >= 8) {
    res.setHeader('Retry-After', Math.ceil((limit.reset_at - now) / 1000))
    throw new HttpError(429, 'LOGIN_LIMIT', '尝试次数过多，请 15 分钟后重试')
  }
  ctx.db
    .prepare(
      'INSERT INTO admin_login_limit VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET attempts = ?, reset_at = ?',
    )
    .run(
      now + 900000,
      limit && limit.reset_at > now ? limit.attempts + 1 : 1,
      limit && limit.reset_at > now ? limit.reset_at : now + 900000,
    )
}
export function authRouter(ctx: Ctx, remoteAddress: RemoteAddressOf) {
  const router = Router()
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  router.use(writeGuard)
  router.get('/status', (req, res) => {
    const user = account(ctx)
    const signedIn = Boolean(user) && authenticated(ctx, req)
    res.json({ setupRequired: !user, authenticated: signedIn, username: signedIn ? user?.username : null })
  })
  router.post('/setup', async (req, res) => {
    if (!isLoopback(remoteAddress(req)))
      throw new HttpError(403, 'SETUP_LOCAL_ONLY', '请在运行 MorphOS 的电脑上设置管理员')
    if (account(ctx)) throw new HttpError(409, 'ADMIN_EXISTS', '管理员已设置，请登录')
    const parsed = Credentials.safeParse(req.body)
    if (!parsed.success)
      throw new HttpError(422, 'CREDENTIALS_INVALID', '账号需为 1–64 个字符，密码需为 12–128 个字符')
    const salt = randomBytes(16).toString('hex')
    const passwordHash = await hash(parsed.data.password, salt)
    // Recheck after asynchronous hashing: simultaneous setup cannot replace the first account.
    if (account(ctx)) throw new HttpError(409, 'ADMIN_EXISTS', '管理员已设置，请登录')
    ctx.db
      .prepare('INSERT INTO admin_account VALUES (1, ?, ?, ?)')
      .run(parsed.data.username, passwordHash.toString('hex'), salt)
    session(ctx, req, res)
    res.status(201).json({ ok: true })
  })
  router.post('/login', async (req, res) => {
    consumePasswordAttempt(ctx, res)
    const parsed = Credentials.safeParse(req.body)
    const user = account(ctx)
    if (!parsed.success || !user) throw new HttpError(401, 'LOGIN_FAILED', '账号或密码不正确')
    const actual = await hash(parsed.data.password, user.salt)
    if (
      !timingSafeEqual(actual, Buffer.from(user.password_hash, 'hex')) ||
      parsed.data.username !== user.username ||
      account(ctx)?.password_hash !== user.password_hash
    )
      throw new HttpError(401, 'LOGIN_FAILED', '账号或密码不正确')
    ctx.db.prepare('UPDATE admin_login_limit SET attempts = 0, reset_at = 0 WHERE id = 1').run()
    session(ctx, req, res)
    res.json({ ok: true })
  })
  router.post('/password', async (req, res) => {
    if (!authenticated(ctx, req)) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录')
    const parsed = z
      .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) })
      .strict()
      .safeParse(req.body)
    if (!parsed.success) throw new HttpError(422, 'PASSWORD_INVALID', '新密码需为 12–128 个字符')
    const user = account(ctx)
    if (!user) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录')
    consumePasswordAttempt(ctx, res)
    const actual = await hash(parsed.data.currentPassword, user.salt)
    if (!timingSafeEqual(actual, Buffer.from(user.password_hash, 'hex')))
      throw new HttpError(403, 'PASSWORD_INCORRECT', '当前密码不正确')
    if (parsed.data.currentPassword === parsed.data.newPassword)
      throw new HttpError(422, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同')
    const salt = randomBytes(16).toString('hex')
    const nextHash = await hash(parsed.data.newPassword, salt)
    tx(ctx.db, () => {
      if (!authenticated(ctx, req) || account(ctx)?.password_hash !== user.password_hash)
        throw new HttpError(409, 'AUTH_CHANGED', '账号状态已变化，请重新登录后再试')
      ctx.db
        .prepare('UPDATE admin_account SET password_hash = ?, salt = ? WHERE id = 1')
        .run(nextHash.toString('hex'), salt)
      ctx.db.prepare('UPDATE admin_sessions SET revoked = 1').run()
      ctx.db.prepare('UPDATE admin_login_limit SET attempts = 0, reset_at = 0 WHERE id = 1').run()
    })
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' })
    res.json({ ok: true })
  })
  router.post('/logout', (req, res) => {
    ctx.db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE token_hash = ?').run(digest(token(req)))
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' })
    res.status(204).end()
  })
  return router
}
export function requireAdmin(ctx: Ctx): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith('/v/')) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    if (!account(ctx) || !authenticated(ctx, req))
      throw new HttpError(401, 'AUTH_REQUIRED', '请登录工作区账号后继续')
    writeGuard(req, res, next)
  }
}
