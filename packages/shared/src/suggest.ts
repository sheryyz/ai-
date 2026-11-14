/**
 * One proactive suggestion (requirements §7 P1). It reads component types and evaluated data only —
 * never an app's name or domain (CLAUDE.md constraint 4) — and only suggests: nothing changes until the
 * user asks the planner and approves its proposal.
 */
import { type EvalContext, evaluateFilter, type FilterExpr, type Row } from './filter'
import type { ParamsOf } from './registry'
import { asRows, evaluateGraph, fieldTypesOf, primaryEntity, recordScope } from './runtime'
import type { AppDefinition } from './schema'

/** A rate under this suggests following up the records that do not meet it yet. */
export const SUGGEST_RATE_BELOW = 0.5
/** Fewer records than this are too few to judge a rate by. */
export const SUGGEST_MIN_ROWS = 5

export interface FollowUpSuggestion {
  /** The ratio Metric (admin page) that triggered it. */
  metricId: string
  metricLabel: string
  rate: number
  /** The metric's condition; records not meeting it are the ones to follow up. */
  where: FilterExpr
  scope: FilterExpr[]
  /** Records the metric counts over. */
  total: number
  /** Records not meeting `where`. */
  remaining: number
  /** …of which no visible message draft reaches. */
  unreached: number
  /** Some message draft already reaches part of the remaining records. */
  partlyReached: boolean
}

/**
 * A ratio Metric on the admin page below SUGGEST_RATE_BELOW over at least SUGGEST_MIN_ROWS records,
 * whose not-yet-meeting records are not all reached by a MessageDraft, suggests drafting a reminder
 * for them. With several such metrics, the lowest rate wins: the requirement is one suggestion.
 */
export function suggestFollowUp(
  def: AppDefinition,
  rows: Row[],
  ctx: EvalContext,
): FollowUpSuggestion | null {
  const graph = evaluateGraph(def, rows, ctx)
  const types = fieldTypesOf(primaryEntity(def))
  const reached = new Set<string>()
  for (const n of def.nodes) {
    if (n.type !== 'MessageDraft' || n.hidden) continue
    for (const r of asRows(graph.get(n.id)?.inputs.recipients)) reached.add(r.id)
  }
  let best: FollowUpSuggestion | null = null
  for (const n of def.nodes) {
    if (n.type !== 'Metric' || n.hidden || n.view !== undefined) continue
    const p = n.params as ParamsOf<'Metric'>
    const where = p.where
    if (p.aggregate !== 'ratio' || !where) continue
    const ev = graph.get(n.id)
    const input = asRows(ev?.inputs.rows)
    const rate = ev?.outputs.value
    if (typeof rate !== 'number' || input.length < SUGGEST_MIN_ROWS || rate >= SUGGEST_RATE_BELOW) continue
    const remaining = input.filter((r) => !evaluateFilter(where, r, types, ctx))
    const unreached = remaining.filter((r) => !reached.has(r.id)).length
    if (unreached === 0) continue
    if (best && best.rate <= rate) continue
    best = {
      metricId: n.id,
      metricLabel: n.title ?? p.label,
      rate,
      where,
      scope: recordScope(def, n.id),
      total: input.length,
      remaining: remaining.length,
      unreached,
      partlyReached: unreached < remaining.length,
    }
  }
  return best
}
