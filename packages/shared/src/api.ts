/**
 * HTTP response shapes shared by server and web (architecture.md §5).
 * Types only — no runtime code, so this module adds nothing to either bundle.
 */
import type { MorphDiff } from './diff'
import type { ViewExposure } from './exposure'
import type { ValidationIssue } from './issues'
import type { StoredRecord } from './runtime'
import type { AppDefinition, EntityDef } from './schema'
import type { ViewNodeSnapshot } from './view-snapshot'

export interface HealthInfo {
  ok: boolean
  protocolVersion: number
  /** Business time zone (ADR-0005); the browser evaluates "today" in this zone too. */
  timeZone: string
  ai: { configured: boolean; model: string; provider: string }
}

export type VersionSource = 'ai' | 'template' | 'restore' | 'manual' | 'recorded'

export interface AppSummary {
  id: string
  name: string
  description: string | null
  icon: string
  version: number
  recordCount: number
  fieldCount: number
  componentCount: number
  hasSampleData: boolean
  lastChange: { source: VersionSource; intent: string | null; summary: string | null; at: string }
  createdAt: string
  updatedAt: string
}

export interface AppDetail {
  id: string
  name: string
  icon: string
  version: number
  definition: AppDefinition
  hasSampleData: boolean
  recordCount: number
  createdAt: string
  updatedAt: string
}

export interface VersionInfo {
  version: number
  source: VersionSource
  intent: string | null
  summary: string | null
  proposalId: string | null
  restoredFrom: number | null
  createdAt: string
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  icon: string
  fieldCount: number
  componentCount: number
  sampleCount: number
  definition: AppDefinition
}

export interface OutboxEntry {
  id: string
  nodeId: string
  channel: string
  recipientCount: number
  messages: { recordId: string; to: string; body: string }[]
  createdAt: string
}

export interface RecordsResponse {
  records: StoredRecord[]
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

// ── AI planner (architecture.md §3) ─────────────────────────────────────────

/** Pipeline steps shown to the user: 理解 → 规划 → 生成 → 校验 → 自修复 → 就绪. */
export type PlanStage = 'understand' | 'plan' | 'generate' | 'validate' | 'repair' | 'ready'
export type StageStatus = 'running' | 'done' | 'failed' | 'skipped'

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'invalid' | 'refused'
export type ProposalOrigin = 'live' | 'recorded' | 'manual'

export interface TraceRound {
  round: number
  ms: number
  reasoning: string
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
  } | null
  finishReason: string | null
  /** Error-level issues found in this round's output (empty when it passed). */
  issues: ValidationIssue[]
}

export interface ProposalTrace {
  origin: ProposalOrigin
  model: string
  promptVersion: string
  temperature: number | null
  context: string
  rounds: TraceRound[]
  totalMs: number
  /** Notes about deterministic adjustments, e.g. replay rebasing — shown to the user, never hidden. */
  notes: string[]
  recording?: { id: string; recordedAt: string; model: string }
}

/** Why the pipeline stopped without a pending proposal. */
export type PlanOutcome = 'pending' | 'refused' | 'blocked' | 'failed'

export interface ProposalRecord {
  id: string
  appId: string | null
  baseVersion: number | null
  kind: 'create' | 'patch' | 'refusal'
  intent: string
  origin: ProposalOrigin
  status: ProposalStatus
  proposal: unknown
  diff: MorphDiff | null
  issues: ValidationIssue[]
  trace: ProposalTrace
  /** Definition the proposal would produce, for the ghost preview. */
  after: AppDefinition | null
  resultAppId: string | null
  resultVersion: number | null
  createdAt: string
  decidedAt: string | null
}

export type PlanEvent =
  | { type: 'stage'; stage: PlanStage; status: StageStatus; round?: number; detail?: string }
  | { type: 'context'; summary: string; origin: ProposalOrigin; model: string }
  | { type: 'thinking'; round: number; delta: string }
  | { type: 'output'; round: number; delta: string }
  | { type: 'issues'; round: number; issues: ValidationIssue[]; repairable: boolean }
  | { type: 'result'; outcome: PlanOutcome; proposal: ProposalRecord }
  | { type: 'error'; code: string; message: string }

export interface RecordingInfo {
  id: string
  title: string
  kind: 'create' | 'patch' | 'refusal'
  intent: string
  model: string
  recordedAt: string
  /** Patch recordings only replay onto an app whose current definition equals the recorded base. */
  applicable?: boolean
}

// ── Role views and share links (protocol §11, ADR-0007 / 0008) ──────────────

/** GET /api/v/:token — everything a share page gets, already trimmed by the server. */
export interface ViewSnapshot {
  app: { name: string; icon: string; description: string | null }
  view: { id: string; label: string; audience: string; description: string | null }
  /** Only the fields this page uses. */
  entity: EntityDef
  nodes: ViewNodeSnapshot[]
  timeZone: string
  today: string
}

/** GET /api/apps/:id/views — admin-side share status of each view in the current definition. */
export interface ViewLinkInfo {
  viewId: string
  label: string
  audience: string
  /** null until the organizer first asks for the link. */
  token: string | null
  /** false when the view has no visible component (the link would answer 410). */
  active: boolean
  exposure: ViewExposure
}

/** GET /api/share-info — where phones can reach this server. */
export interface ShareInfo {
  port: number
  /** LAN addresses of this machine, or PUBLIC_BASE_URL when set. */
  baseUrls: string[]
  /** false in development: the server does not serve the web app, so share links only open on this machine. */
  servesWeb: boolean
}
