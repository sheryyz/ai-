import { formatPath, z } from '@morphos/shared'
import type { Request, Response } from 'express'
import { badRequest } from '../errors'

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const r = schema.safeParse(req.body ?? {})
  if (!r.success) {
    throw badRequest(
      '请求参数不正确',
      r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    )
  }
  return r.data
}

export function intParam(value: string | undefined, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${name} 必须是正整数`)
  return n
}

export const ValuesSchema = z.record(z.string(), z.unknown())

export function sendCsv(res: Response, out: { filename: string; csv: string; count: number }): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
  )
  res.setHeader('X-Record-Count', String(out.count))
  res.send(out.csv)
}
