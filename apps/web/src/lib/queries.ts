/** Server state via TanStack Query (architecture.md §6). Keys are centralised so mutations invalidate precisely. */
import { DEFAULT_TIME_ZONE, localDate } from '@morphos/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api'

export const keys = {
  health: ['health'] as const,
  templates: ['templates'] as const,
  apps: ['apps'] as const,
  app: (id: string) => ['app', id] as const,
  records: (id: string) => ['app', id, 'records'] as const,
  versions: (id: string) => ['app', id, 'versions'] as const,
  outbox: (id: string) => ['app', id, 'outbox'] as const,
  proposals: (id: string) => ['app', id, 'proposals'] as const,
  recordings: (appId?: string) => ['recordings', appId ?? null] as const,
  views: (id: string) => ['app', id, 'views'] as const,
  shareInfo: ['share-info'] as const,
  snapshot: (token: string) => ['share', token] as const,
}

/** Share pages and the admin page see each other's writes within a few seconds (requirements §7 P0). */
export const POLL_MS = 3_000

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 30_000, retry: 1 })
}

/**
 * Why the AI input is unavailable, or null when a live model is configured.
 * "Server unreachable" must not read as "offline mode": the fix differs (start the server vs. set a key).
 */
export function useAiBlocker(): string | null {
  const health = useHealth()
  if (health.isPending) return '正在连接服务…'
  if (health.isError) return '无法连接服务器，AI 生成暂不可用。请确认服务已启动后刷新页面。'
  return health.data.ai.configured ? null : '离线模式：未配置模型（LLM_API_KEY），可回放演示样例。'
}

export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: api.templates })
export const useApps = () => useQuery({ queryKey: keys.apps, queryFn: api.apps })
export const useApp = (id: string) => useQuery({ queryKey: keys.app(id), queryFn: () => api.app(id) })
export const useRecords = (id: string, opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: keys.records(id),
    queryFn: () => api.records(id),
    refetchInterval: opts.poll ? POLL_MS : false,
  })
export const useVersions = (id: string) =>
  useQuery({ queryKey: keys.versions(id), queryFn: () => api.versions(id) })
export const useOutbox = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.outbox(id), queryFn: () => api.outbox(id), enabled: enabled && Boolean(id) })

export function useTimeZone(): string {
  return useHealth().data?.timeZone ?? DEFAULT_TIME_ZONE
}

/** "Today" in the business time zone (ADR-0005), refreshed every minute so a page left open rolls over. */
export function useToday(): string {
  const tz = useTimeZone()
  const [today, setToday] = useState(() => localDate(new Date(), tz))
  useEffect(() => {
    setToday(localDate(new Date(), tz))
    const t = setInterval(() => setToday(localDate(new Date(), tz)), 60_000)
    return () => clearInterval(t)
  }, [tz])
  return today
}

export const useProposals = (id: string) =>
  useQuery({ queryKey: keys.proposals(id), queryFn: () => api.proposals(id) })
export const useRecordings = (appId?: string) =>
  useQuery({ queryKey: keys.recordings(appId), queryFn: () => api.recordings(appId) })
