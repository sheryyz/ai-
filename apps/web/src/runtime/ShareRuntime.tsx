/**
 * Renders a share page from the server's trimmed snapshot (protocol §11.4). Same components as the admin
 * page; rows and statistics come precomputed, and every write goes through the share link.
 */
import type { NodeEval, ViewNodeData, ViewSnapshot } from '@morphos/shared'
import { useQueryClient } from '@tanstack/react-query'
import { shareApi } from '../lib/api'
import { keys } from '../lib/queries'
import { renderNode } from './AppRuntime'
import { RuntimeContext, type RuntimeContextValue, type RuntimeOps } from './context'

function evOf(data: ViewNodeData): NodeEval | undefined {
  if (data.kind !== 'rows') return undefined
  return { inputs: { rows: data.rows, recipients: data.rows }, outputs: {} }
}

export function ShareRuntime({ token, snapshot }: { token: string; snapshot: ViewSnapshot }) {
  const qc = useQueryClient()
  const ops: RuntimeOps = {
    createRecord: (nodeId, values) => shareApi.submit(token, nodeId, values),
    runAction: (nodeId, recordId, answers) => shareApi.act(token, nodeId, recordId, answers),
    recordOutbox: (nodeId) => shareApi.outbox(token, nodeId),
    exportUrl: (nodeId) => shareApi.exportUrl(token, nodeId),
    refresh: () => qc.invalidateQueries({ queryKey: keys.snapshot(token) }),
  }
  const ctx: RuntimeContextValue = {
    appId: '',
    entity: snapshot.entity,
    mode: 'share',
    timeZone: snapshot.timeZone,
    today: snapshot.today,
    totalRecords: Math.max(
      0,
      ...snapshot.nodes.map((n) => (n.data.kind === 'rows' ? n.data.rows.length : 0)),
    ),
    ops,
  }
  return (
    <RuntimeContext.Provider value={ctx}>
      <div className="flex flex-col gap-4">
        {snapshot.nodes.map(({ node, data }) => (
          <div key={node.id} data-node={node.id} className="min-w-0">
            {renderNode(node, evOf(data), undefined, data)}
          </div>
        ))}
      </div>
    </RuntimeContext.Provider>
  )
}
