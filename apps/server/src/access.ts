/**
 * ADR-0008 — the admin API answers only connections from this machine; share links (/api/v/*) and
 * /api/health answer anyone. The decision uses the TCP peer address, never forwarding headers.
 */
import type { Request, RequestHandler } from 'express'
import type { AppConfig } from './config'

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

export type RemoteAddressOf = (req: Request) => string | undefined
export const socketAddress: RemoteAddressOf = (req) => req.socket.remoteAddress

/** Mounted at /api, after /api/health. */
export function adminLocalOnly(config: AppConfig, remoteAddressOf: RemoteAddressOf): RequestHandler {
  return (req, res, next) => {
    if (config.adminAccess === 'any' || req.path.startsWith('/v/') || isLoopback(remoteAddressOf(req))) {
      next()
      return
    }
    res.status(403).json({
      error: {
        code: 'ADMIN_LOCAL_ONLY',
        message: '管理功能仅限运行 MorphOS 的电脑访问；手机请使用组织者分享的页面链接',
      },
    })
  }
}
