/** Reads the planner's NDJSON stream (architecture.md §3), one PlanEvent per line. */
import type { PlanEvent } from '@morphos/shared'
import { ApiError } from './api'

export type PlanRequest = { intent: string; appId?: string } | { recordingId: string; appId?: string }

export async function streamPlan(
  body: PlanRequest,
  onEvent: (ev: PlanEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/ai/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (signal?.aborted) return
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认服务已启动')
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message ?? `请求失败（HTTP ${res.status}）`,
    )
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) onEvent(JSON.parse(line) as PlanEvent)
        nl = buf.indexOf('\n')
      }
    }
  } catch {
    if (signal?.aborted) return
    throw new ApiError(0, 'STREAM_INTERRUPTED', '与服务器的连接中断，规划未完成，请重试')
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as PlanEvent)
}
