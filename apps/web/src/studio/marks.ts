import type { MorphDiff } from '@morphos/shared'
import type { Mark } from '../runtime/NodeFrame'

/** Per-node ghost-layer marks for previewing a proposal (design.md: dashed + morph colour for AI changes). */
export function diffMarks(diff: MorphDiff | null | undefined): Map<string, Mark> {
  const m = new Map<string, Mark>()
  if (!diff) return m
  for (const n of diff.nodes.moved) m.set(n.nodeId, 'moved')
  for (const n of diff.nodes.changed) m.set(n.nodeId, 'changed')
  for (const id of diff.nodes.hidden) m.set(id, 'hidden')
  for (const n of diff.nodes.added) m.set(n.id, 'added')
  return m
}
