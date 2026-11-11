import type { EntityDef, NodeEval } from '@morphos/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { keys } from '../lib/queries'
import type { Mark } from './NodeFrame'

export type RuntimeMode = 'live' | 'preview'

export interface RuntimeContextValue {
  appId: string
  entity: EntityDef
  /** 'preview' renders a proposed definition: everything is visible, nothing can write. */
  mode: RuntimeMode
  timeZone: string
  today: string
  totalRecords: number
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
