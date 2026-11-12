/**
 * AI planning pipeline (architecture.md §3, ADR-0004):
 * understand → plan (reasoning stream) → generate (JSON) → validate L1–L6 ⇄ repair (≤ 2 rounds) → ready.
 *
 * The model's output is untrusted data. It is parsed, validated and diffed here and stored as a *pending*
 * proposal; nothing reaches app_versions or records until a human approves it.
 */
import {
  type AppDefinition,
  computeDiff,
  hasErrors,
  issue,
  type PlanEvent,
  type PlanOutcome,
  type PlanStage,
  type ProposalRecord,
  type ProposalTrace,
  primaryEntity,
  REGISTRY,
  type StoredRecord,
  type TraceRound,
  type ValidationIssue,
  validateProposal,
} from '@morphos/shared'
import type { Ctx } from '../context'
import { type LlmClient, LlmError } from '../llm/client'
import {
  buildMessages,
  createTaskMessage,
  PROMPT_VERSION,
  patchTaskMessage,
  REGENERATE_PROMPT_SUFFIX,
  regenerateTaskMessage,
  repairMessage,
} from '../llm/prompt'
import { getApp } from './apps'
import { saveProposal } from './proposals'
import { listStored } from './records'

export const MAX_REPAIR_ROUNDS = 2

export interface PlanInput {
  intent: string
  /** Present for evolution (patch); absent for creating a new app. */
  appId?: string
  /** Replay only: the version the recording was made against, rebased onto the current version. */
  rebaseFrom?: number
  recording?: ProposalTrace['recording']
  /**
   * Evaluation only (eval/README.md), never reachable over HTTP: "regenerate" asks the model for a complete
   * new definition of an existing app — the whole-regeneration baseline compared against incremental patches.
   */
  strategy?: 'patch' | 'regenerate'
}

/** Safety-layer findings are never auto-repaired: "fixing" them would silently change what the user asked for. */
const BLOCKING_CODES = new Set(['SAFETY_FORBIDDEN_OP', 'SAFETY_DESTRUCTIVE_SCHEMA'])

/** Extracts the JSON object from model output, tolerating code fences or stray prose around it. */
export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (e) {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) }
      } catch {
        /* fall through to the original error */
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

interface Evaluation {
  issues: ValidationIssue[]
  repairable: boolean
  proposal?: unknown
  kind?: 'create' | 'patch' | 'refusal'
  after?: AppDefinition
}

function contextSummary(app: { definition: AppDefinition; version: number } | null, records: StoredRecord[]) {
  if (!app) return '新建应用：没有现有定义，将生成完整的应用定义'
  const def = app.definition
  const visual = def.nodes.filter((n) => REGISTRY[n.type].visual).length
  return `已读取「${def.name}」v${app.version}：${primaryEntity(def).fields.length} 个字段、${visual} 个组件、${def.bindings.length} 条数据连接、${records.length} 条记录（只向模型发送统计，不发送记录内容）`
}

export async function runPlan(
  ctx: Ctx,
  client: LlmClient,
  input: PlanInput,
  onEvent: (ev: PlanEvent) => void,
  signal?: AbortSignal,
): Promise<ProposalRecord | null> {
  const started = Date.now()
  // Stages still running when the model call throws are closed as failed, so no step is left spinning.
  const running = new Map<PlanStage, number | undefined>()
  const emit = (ev: PlanEvent) => {
    if (ev.type === 'stage') {
      if (ev.status === 'running') running.set(ev.stage, ev.round)
      else running.delete(ev.stage)
    }
    onEvent(ev)
  }
  const trace: ProposalTrace = {
    origin: client.origin,
    model: client.model,
    promptVersion:
      input.strategy === 'regenerate' ? PROMPT_VERSION + REGENERATE_PROMPT_SUFFIX : PROMPT_VERSION,
    temperature: client.temperature,
    context: '',
    rounds: [],
    totalMs: 0,
    notes: [],
    ...(input.recording ? { recording: input.recording } : {}),
  }

  // ── understand ────────────────────────────────────────────────────────────
  emit({ type: 'stage', stage: 'understand', status: 'running' })
  const initial = input.appId ? getApp(ctx, input.appId) : null
  const records = input.appId ? listStored(ctx, input.appId) : []
  const regenerate = initial !== null && input.strategy === 'regenerate'
  const mode = initial && !regenerate ? 'patch' : 'create'
  trace.context = contextSummary(initial, records)
  emit({ type: 'context', summary: trace.context, origin: client.origin, model: client.model })
  emit({ type: 'stage', stage: 'understand', status: 'done' })

  const task = !initial
    ? createTaskMessage(input.intent)
    : regenerate
      ? regenerateTaskMessage(input.intent, initial.definition, records)
      : patchTaskMessage(input.intent, initial.definition, initial.version, records)
  const history: { output: string; repair: string }[] = []

  const evaluate = (content: string): Evaluation => {
    const parsed = parseModelJson(content)
    if (!parsed.ok) {
      return {
        repairable: true,
        issues: [
          issue(
            'schema',
            'SCHEMA_JSON_PARSE',
            '',
            `输出不是合法的 JSON：${parsed.error}`,
            '只输出一个 JSON 对象',
          ),
        ],
      }
    }
    const raw = parsed.value
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>
      if (typeof obj.intent !== 'string' || !obj.intent.trim()) {
        obj.intent = input.intent
        trace.notes.push('模型未复述需求，intent 已由系统填入用户原话')
      }
      if (input.rebaseFrom !== undefined && obj.baseVersion === input.rebaseFrom && initial) {
        obj.baseVersion = initial.version
        if (input.rebaseFrom !== initial.version) {
          trace.notes.push(
            `演示回放：录制时基于 v${input.rebaseFrom}，当前定义与录制时完全一致，baseVersion 改写为 v${initial.version}`,
          )
        }
      }
    }
    const kind = (raw as { kind?: unknown } | null)?.kind
    if (kind !== 'refusal' && kind !== mode && (kind === 'create' || kind === 'patch')) {
      return {
        repairable: true,
        issues: [
          issue(
            'schema',
            'PROPOSAL_KIND_MISMATCH',
            'kind',
            mode === 'create'
              ? regenerate
                ? '当前任务是输出完整的新应用定义，应输出 kind="create"'
                : '当前任务是创建新应用，应输出 kind="create"'
              : '当前任务是修改现有应用，应输出 kind="patch"',
          ),
        ],
      }
    }

    // Re-read the app: if it moved while the model was thinking, the base is stale (not the model's fault).
    const current = input.appId ? getApp(ctx, input.appId) : null
    if (current && initial && current.version !== initial.version) {
      return {
        repairable: false,
        issues: [
          issue(
            'version',
            'VERSION_CONFLICT',
            'baseVersion',
            `规划期间应用已从 v${initial.version} 更新到 v${current.version}`,
            '请基于最新版本重新描述需求',
          ),
        ],
      }
    }
    const v = validateProposal(
      raw,
      current ? { current: { definition: current.definition, version: current.version } } : {},
    )
    const errors = v.issues.filter((i) => i.level === 'error')
    if (!errors.length && v.after && v.proposal?.kind !== 'refusal') {
      const diff = computeDiff(current?.definition ?? null, v.after, {
        fromVersion: current?.version ?? 0,
        recordCount: records.length,
      })
      if (diff.isEmpty) {
        return {
          repairable: true,
          issues: [
            issue(
              'schema',
              'PROPOSAL_EMPTY',
              'operations',
              '提案没有对应用产生任何变化',
              '检查操作是否正确；如果需求已经满足，请输出 kind="refusal" 并说明原因',
            ),
          ],
        }
      }
    }
    return {
      issues: v.issues,
      repairable: !v.issues.some((i) => BLOCKING_CODES.has(i.code)),
      proposal: v.proposal ?? raw,
      kind: v.proposal?.kind,
      after: v.after,
    }
  }

  let outcome: PlanOutcome = 'failed'
  let final: Evaluation | null = null

  try {
    for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
      if (round > 0) emit({ type: 'stage', stage: 'repair', status: 'running', round })
      emit({ type: 'stage', stage: 'plan', status: 'running', round })
      const t0 = Date.now()
      let generating = false
      const result = await client.chat(buildMessages(task, history), {
        json: true,
        signal,
        onReasoning: (delta) => emit({ type: 'thinking', round, delta }),
        onContent: (delta) => {
          if (!generating) {
            generating = true
            emit({ type: 'stage', stage: 'plan', status: 'done', round })
            emit({ type: 'stage', stage: 'generate', status: 'running', round })
          }
          emit({ type: 'output', round, delta })
        },
      })
      if (!generating) emit({ type: 'stage', stage: 'plan', status: 'done', round })
      emit({ type: 'stage', stage: 'generate', status: 'done', round })

      emit({ type: 'stage', stage: 'validate', status: 'running', round })
      const ev = evaluate(result.content)
      const errors = ev.issues.filter((i) => i.level === 'error')
      const tr: TraceRound = {
        round,
        ms: Date.now() - t0,
        reasoning: result.reasoning,
        content: result.content,
        usage: result.usage,
        finishReason: result.finishReason,
        issues: errors,
      }
      trace.rounds.push(tr)
      final = ev

      if (!hasErrors(ev.issues)) {
        emit({ type: 'stage', stage: 'validate', status: 'done', round })
        if (round > 0) emit({ type: 'stage', stage: 'repair', status: 'done', round })
        outcome = ev.kind === 'refusal' ? 'refused' : 'pending'
        break
      }

      emit({
        type: 'issues',
        round,
        issues: ev.issues,
        repairable: ev.repairable && round < MAX_REPAIR_ROUNDS,
      })
      emit({ type: 'stage', stage: 'validate', status: 'failed', round })
      if (!ev.repairable) {
        outcome = ev.issues.some((i) => BLOCKING_CODES.has(i.code)) ? 'blocked' : 'failed'
        if (round > 0) emit({ type: 'stage', stage: 'repair', status: 'failed', round })
        break
      }
      if (round === MAX_REPAIR_ROUNDS) {
        if (round > 0) emit({ type: 'stage', stage: 'repair', status: 'failed', round })
        outcome = 'failed'
        break
      }
      if (round > 0) emit({ type: 'stage', stage: 'repair', status: 'failed', round })
      history.push({ output: result.content, repair: repairMessage(ev.issues, round + 1, MAX_REPAIR_ROUNDS) })
    }
  } catch (e) {
    const err =
      e instanceof LlmError ? e : new LlmError('LLM_UPSTREAM', e instanceof Error ? e.message : '未知错误')
    for (const [stage, round] of running) emit({ type: 'stage', stage, status: 'failed', round })
    emit({ type: 'stage', stage: 'ready', status: 'failed' })
    emit({ type: 'error', code: err.code, message: err.message })
    return null
  }

  trace.totalMs = Date.now() - started
  const current = input.appId ? getApp(ctx, input.appId) : null
  const after = outcome === 'pending' ? (final?.after ?? null) : null
  const diff = after
    ? computeDiff(current?.definition ?? null, after, {
        fromVersion: current?.version ?? 0,
        recordCount: records.length,
      })
    : null
  const kind = final?.kind ?? (mode === 'create' ? 'create' : 'patch')
  const saved = saveProposal(ctx, {
    appId: input.appId ?? null,
    baseVersion: current?.version ?? null,
    kind,
    intent: input.intent,
    origin: client.origin,
    status: outcome === 'pending' ? 'pending' : outcome === 'refused' ? 'refused' : 'invalid',
    proposal: final?.proposal ?? null,
    diff,
    issues: final?.issues ?? [],
    trace,
    after,
  })
  emit({
    type: 'stage',
    stage: 'ready',
    status: outcome === 'pending' || outcome === 'refused' ? 'done' : 'failed',
  })
  emit({ type: 'result', outcome, proposal: saved })
  return saved
}
