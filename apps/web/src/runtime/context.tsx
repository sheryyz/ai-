import type { EntityDef, NodeEval, OutboxEntry, ViewNodeData } from '@morphos/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { api } from '../lib/api'
import { keys } from '../lib/queries'
import type { Mark } from './NodeFrame'

/**
 * live    — the admin page: full records, every write the components grant.
 * preview — a proposed definition: everything is visible, nothing can write.
 * share   — a share page (protocol §11.4): server-trimmed data, writes only through the share link.
 */
export type RuntimeMode = 'live' | 'preview' | 'share'

/** Record operations behind the components, so the same components serve the admin page and share links. */
export interface RuntimeOps {
  createRecord(nodeId: string, values: Record<string, unknown>): Promise<unknown>
  runAction(nodeId: string, recordId: string, answers: Record<string, unknown>): Promise<unknown>
  recordOutbox(nodeId: string): Promise<OutboxEntry>
  exportUrl(nodeId: string): string
  /** Re-read data after a write. */
  refresh(): Promise<unknown>
}

export interface RuntimeContextValue {
  appId: string
  entity: EntityDef
  mode: RuntimeMode
  timeZone: string
  today: string
  totalRecords: number
  ops: RuntimeOps
}

export const RuntimeContext = createContext<RuntimeContextValue | null>(null)

export function useRuntime(): RuntimeContextValue {
  const v = useContext(RuntimeContext)
  if (!v) throw new Error('useRuntime must be used inside <AppRuntime>')
  return v
}

export interface NodeProps<P> {
  nodeId: string
  title?: string
  params: P
  ev: NodeEval | undefined
  mark?: Mark
  /** Share pages: statistics precomputed by the server instead of rows (protocol §11.4). */
  data?: ViewNodeData
}

/** After any record write, re-read records (graph re-evaluates) and the hub counts. */
export function useInvalidateRecords(appId: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.records(appId) }),
      qc.invalidateQueries({ queryKey: keys.apps }),
      qc.invalidateQueries({ queryKey: keys.app(appId) }),
    ])
}

/** Admin-page operations: the app-scoped API. */
export function useAdminOps(appId: string): RuntimeOps {
  const invalidate = useInvalidateRecords(appId)
  return {
    createRecord: (nodeId, values) => api.createRecord(appId, nodeId, values),
    runAction: (nodeId, recordId, answers) => api.runAction(appId, nodeId, recordId, answers),
    recordOutbox: (nodeId) => api.recordOutbox(appId, nodeId),
    exportUrl: (nodeId) => api.exportUrl(appId, nodeId),
    refresh: invalidate,
  }
}
