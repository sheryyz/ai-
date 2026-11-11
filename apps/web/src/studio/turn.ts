/**
 * One AI turn, built either live from the NDJSON event stream or from a stored ProposalRecord,
 * so the conversation renders history and in-flight planning with the same component.
 */
import type {
  PlanEvent,
  PlanOutcome,
  PlanStage,
  ProposalOrigin,
  ProposalRecord,
  StageStatus,
  ValidationIssue,
} from '@morphos/shared'

export const STAGES: PlanStage[] = ['understand', 'plan', 'generate', 'validate', 'repair', 'ready']
export const STAGE_LABELS: Record<PlanStage, string> = {
  understand: '理解',
  plan: '规划',
  generate: '生成',
  validate: '校验',
  repair: '自修复',
  ready: '就绪',
}

export interface RoundView {
  round: number
  thinking: string
  outputChars: number
  issues: ValidationIssue[]
  repairable: boolean
  ms?: number
  tokens?: number
}

export interface Turn {
  key: string
  intent: string
  live: boolean
  origin?: ProposalOrigin
  model?: string
  context?: string
  stages: Partial<Record<PlanStage, { status: StageStatus; round?: number }>>
  rounds: RoundView[]
  outcome?: PlanOutcome
  proposal?: ProposalRecord
  error?: { code: string; message: string }
  done: boolean
  startedAt: number
  totalMs?: number
}

export function newTurn(intent: string): Turn {
  return {
    key: `live-${Date.now()}`,
    intent,
    live: true,
    stages: {},
    rounds: [],
    done: false,
    startedAt: Date.now(),
  }
}

function round(t: Turn, r: number): RoundView {
  let rv = t.rounds.find((x) => x.round === r)
  if (!rv) {
    rv = { round: r, thinking: '', outputChars: 0, issues: [], repairable: false }
    t.rounds = [...t.rounds, rv].sort((a, b) => a.round - b.round)
  }
  return rv
}

export function reduceTurn(prev: Turn, ev: PlanEvent): Turn {
  const t: Turn = { ...prev, stages: { ...prev.stages }, rounds: prev.rounds.map((r) => ({ ...r })) }
  switch (ev.type) {
    case 'stage':
      t.stages[ev.stage] = { status: ev.status, round: ev.round }
      break
    case 'context':
      t.context = ev.summary
      t.origin = ev.origin
      t.model = ev.model
      break
    case 'thinking':
      round(t, ev.round).thinking += ev.delta
      break
    case 'output':
      round(t, ev.round).outputChars += ev.delta.length
      break
    case 'issues': {
      const rv = round(t, ev.round)
      rv.issues = ev.issues
      rv.repairable = ev.repairable
      break
    }
    case 'result':
      t.outcome = ev.outcome
      t.proposal = ev.proposal
      t.totalMs = Date.now() - t.startedAt
      if (t.outcome === 'pending' || t.outcome === 'refused') t.stages.repair ??= { status: 'skipped' }
      break
    case 'error':
      t.error = { code: ev.code, message: ev.message }
      break
  }
  return t
}

/** Outcome of a stored proposal: invalid proposals stopped by the safety layer count as "blocked". */
export function outcomeOf(p: ProposalRecord): PlanOutcome {
  if (p.status === 'refused') return 'refused'
  if (p.status === 'invalid') {
    return p.issues.some((i) => i.code === 'SAFETY_FORBIDDEN_OP' || i.code === 'SAFETY_DESTRUCTIVE_SCHEMA')
      ? 'blocked'
      : 'failed'
  }
  return 'pending'
}

export function fromRecord(p: ProposalRecord): Turn {
  const outcome = outcomeOf(p)
  const ok = outcome === 'pending' || outcome === 'refused'
  const n = p.trace.rounds.length
  return {
    key: p.id,
    intent: p.intent,
    live: false,
    origin: p.origin,
    model: p.trace.model,
    context: p.trace.context,
    stages: {
      understand: { status: 'done' },
      plan: { status: 'done' },
      generate: { status: 'done' },
      validate: { status: ok ? 'done' : 'failed' },
      repair: {
        status:
          n > 1 ? (ok ? 'done' : 'failed') : outcome === 'blocked' ? 'skipped' : ok ? 'skipped' : 'failed',
      },
      ready: { status: ok ? 'done' : 'failed' },
    },
    rounds: p.trace.rounds.map((r) => ({
      round: r.round,
      thinking: r.reasoning,
      outputChars: r.content.length,
      issues: r.issues,
      repairable: r.round < n - 1,
      ms: r.ms,
      tokens: r.usage?.totalTokens,
    })),
    outcome,
    proposal: p,
    done: true,
    startedAt: new Date(p.createdAt).getTime(),
    totalMs: p.trace.totalMs,
  }
}
