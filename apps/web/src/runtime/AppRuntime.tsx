/**
 * Generic renderer: AppDefinition + stored records → evaluated binding graph → laid-out components.
 * There is no app-specific code anywhere in the runtime (CLAUDE.md constraint 4).
 */
import {
  type AppDefinition,
  evaluateGraph,
  layoutNodes,
  materialize,
  type NodeDef,
  type NodeEval,
  type ParamsOf,
  primaryEntity,
  type StoredRecord,
} from '@morphos/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { cn } from '../lib/cn'
import { useTimeZone, useToday } from '../lib/queries'
import { RuntimeContext, type RuntimeContextValue, type RuntimeMode } from './context'
import type { Mark } from './NodeFrame'
import { ChartNode } from './nodes/ChartNode'
import { CSVExportNode } from './nodes/CSVExportNode'
import { FilterNode } from './nodes/FilterNode'
import { FormNode } from './nodes/FormNode'
import { MessageDraftNode } from './nodes/MessageDraftNode'
import { MetricNode } from './nodes/MetricNode'
import { QuickActionNode } from './nodes/QuickActionNode'
import { TableNode } from './nodes/TableNode'

function renderNode(node: NodeDef, ev: NodeEval | undefined, mark: Mark | undefined) {
  const base = { nodeId: node.id, title: node.title, ev, mark }
  switch (node.type) {
    case 'Metric':
      return <MetricNode {...base} params={node.params as ParamsOf<'Metric'>} />
    case 'Chart':
      return <ChartNode {...base} params={node.params as ParamsOf<'Chart'>} />
    case 'Filter':
      return <FilterNode {...base} params={node.params as ParamsOf<'Filter'>} />
    case 'Table':
      return <TableNode {...base} params={node.params as ParamsOf<'Table'>} />
    case 'Form':
      return <FormNode {...base} params={node.params as ParamsOf<'Form'>} />
    case 'QuickAction':
      return <QuickActionNode {...base} params={node.params as ParamsOf<'QuickAction'>} />
    case 'MessageDraft':
      return <MessageDraftNode {...base} params={node.params as ParamsOf<'MessageDraft'>} />
    case 'CSVExport':
      return <CSVExportNode {...base} params={node.params as ParamsOf<'CSVExport'>} />
    case 'CollectionSource':
      return null
  }
}

const GROW = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: 0.22, ease: 'easeOut' },
} as const

export function AppRuntime({
  appId,
  definition,
  records,
  mode = 'live',
  marks,
  className,
}: {
  appId: string
  definition: AppDefinition
  records: StoredRecord[]
  mode?: RuntimeMode
  /** Per-node Diff marks for the ghost preview of a pending proposal. */
  marks?: Map<string, Mark>
  className?: string
}) {
  const today = useToday()
  const timeZone = useTimeZone()
  const entity = primaryEntity(definition)
  const rows = useMemo(() => records.map((r) => materialize(r, entity)), [records, entity])
  const graph = useMemo(() => evaluateGraph(definition, rows, { today }), [definition, rows, today])
  const showHidden = mode === 'preview' && [...(marks?.values() ?? [])].includes('hidden')
  const layout = layoutNodes(definition, { includeHidden: showHidden })
  const ctx: RuntimeContextValue = { appId, entity, mode, timeZone, today, totalRecords: records.length }

  const item = (n: NodeDef, inMain: boolean) => (
    <motion.div
      key={`${n.type}:${n.id}`}
      layout="position"
      {...GROW}
      className={cn(inMain && (n.width === 'half' ? 'md:col-span-1' : 'md:col-span-2'), 'min-w-0')}
      data-node={n.id}
    >
      {renderNode(n, graph.get(n.id), marks?.get(n.id))}
    </motion.div>
  )

  return (
    <RuntimeContext.Provider value={ctx}>
      <div
        className={cn(
          'grid items-start gap-4',
          layout.aside.length ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]' : '',
          className,
        )}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {layout.main.map((n) => item(n, true))}
          </AnimatePresence>
        </div>
        {layout.aside.length ? (
          <aside className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {layout.aside.map((n) => item(n, false))}
            </AnimatePresence>
          </aside>
        ) : null}
      </div>
    </RuntimeContext.Provider>
  )
}
