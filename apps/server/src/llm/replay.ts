/**
 * Offline demo mode: replays *recorded real model responses* (fixtures/recorded/) through the very same
 * planner pipeline — parsing, six-layer validation, repair and Morph Diff all run for real; only the
 * model's text is replayed. Every replayed proposal is labelled "演示样例 · 非实时生成" with model and date.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { type AppDefinition, type RecordingInfo, stableStringify } from '@morphos/shared'
import { REPO_ROOT } from '../config'
import { notFound } from '../errors'
import { type ChatResult, type LlmClient, LlmError, type Usage } from './client'

export interface Recording {
  id: string
  title: string
  kind: 'create' | 'patch' | 'refusal'
  intent: string
  model: string
  recordedAt: string
  promptVersion: string
  temperature: number | null
  /** For patch recordings: the exact definition and version the model saw. */
  base: { version: number; definition: AppDefinition } | null
  rounds: {
    reasoning: string
    content: string
    usage: Usage | null
    finishReason: string | null
    ms: number
  }[]
}

export const RECORDINGS_DIR = path.join(REPO_ROOT, 'fixtures/recorded')

let cache: Recording[] | undefined

export function loadRecordings(dir = RECORDINGS_DIR): Recording[] {
  if (cache && dir === RECORDINGS_DIR) return cache
  const list = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Recording)
    : []
  if (dir === RECORDINGS_DIR) cache = list
  return list
}

export function getRecording(id: string): Recording {
  const r = loadRecordings().find((x) => x.id === id)
  if (!r) throw notFound('演示样例')
  return r
}

/** A patch recording only replays onto an app whose current definition is identical to the recorded base. */
export function isApplicable(rec: Recording, current: AppDefinition | null): boolean {
  if (rec.kind === 'create' || !rec.base) return current === null
  return current !== null && stableStringify(rec.base.definition) === stableStringify(current)
}

export function recordingInfo(rec: Recording, current?: AppDefinition | null): RecordingInfo {
  return {
    id: rec.id,
    title: rec.title,
    kind: rec.kind,
    intent: rec.intent,
    model: rec.model,
    recordedAt: rec.recordedAt,
    ...(current !== undefined ? { applicable: isApplicable(rec, current) } : {}),
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new LlmError('LLM_ABORTED', '已取消'))
    })
  })

/** Streams a string in small slices so the UI shows the same progressive thinking/output as a live call. */
async function stream(
  text: string,
  budgetMs: number,
  emit: ((d: string) => void) | undefined,
  signal?: AbortSignal,
) {
  if (!text || !emit) return
  const steps = Math.max(1, Math.min(120, Math.ceil(text.length / 24)))
  const size = Math.ceil(text.length / steps)
  for (let i = 0; i < text.length; i += size) {
    emit(text.slice(i, i + size))
    await sleep(budgetMs / steps, signal)
  }
}

export function createReplayClient(rec: Recording, opts: { speed?: number } = {}): LlmClient {
  let next = 0
  const speed = opts.speed ?? 1
  return {
    model: rec.model,
    origin: 'recorded',
    temperature: rec.temperature,
    async chat(_messages, o): Promise<ChatResult> {
      const round = rec.rounds[next++]
      if (!round) throw new LlmError('LLM_UPSTREAM', '演示样例已回放完毕，但结果仍未通过校验')
      // Compress real latency into a few seconds; speed 0 (tests) replays instantly.
      await stream(round.reasoning, 2400 * speed, o.onReasoning, o.signal)
      await stream(round.content, 1600 * speed, o.onContent, o.signal)
      return {
        content: round.content,
        reasoning: round.reasoning,
        usage: round.usage,
        model: rec.model,
        finishReason: round.finishReason,
      }
    },
  }
}
