/**
 * Strategy evaluation (requirements.md §8, eval/README.md): A whole regeneration vs B incremental patch,
 * on the fixed case set in eval/cases.json, against the live model configured in .env.
 *
 *   npm run eval -w @morphos/server                      full run → eval/results/<date>-<model>.{json,md}
 *   npm run eval -w @morphos/server -- --only=c01,e01    smoke run, printed only, nothing written
 *
 * Both strategies go through the very same planner pipeline (six-layer validation, ≤ 2 repair rounds);
 * only the task message differs. Every number in the output comes from this run — nothing is filled in.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type AppDefinition, localDate, type ProposalRecord, type StoredRecord } from '@morphos/shared'
import { createApp as createServer } from '../app'
import { loadEnvFile, parseConfig, REPO_ROOT } from '../config'
import { PROMPT_VERSION } from '../llm/prompt'
import { createApp } from '../services/apps'
import { runPlan } from '../services/planner'
import { listStored, seedRecords } from '../services/records'
import { getTemplate, resolveSamples } from '../services/templates'
import { countPreserved, destructiveChanges, percentile, unrelatedChanges } from './eval-metrics'

type TemplateId = 'event-registration' | 'equipment-lending'
type Group = 'create' | 'evolve' | 'illegal'
type Strategy = 'A' | 'B' | 'AB'
interface Case {
  id: string
  intent: string
  base?: TemplateId
  allowTouch?: string[]
  kind?: string
}
interface Cases {
  create: Case[]
  evolve: Case[]
  illegal: Case[]
}
type Outcome = 'pending' | 'refused' | 'blocked' | 'failed' | 'error'

export interface EvalRun {
  caseId: string
  group: Group
  strategy: Strategy
  intent: string
  outcome: Outcome
  rounds: number
  /** Error-level issues per round as "layer:CODE". */
  roundIssues: string[][]
  totalMs: number
  tokens: number | null
  seeded: number | null
  preserved: number | null
  destructive: string[] | null
  unrelated: string[] | null
  summary: string | null
  error: string | null
  output: unknown
}

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)
const only = args.get('only')?.split(',')
const concurrency = Number(args.get('concurrency') ?? 4)

loadEnvFile()
const config = parseConfig({ ...process.env, DATABASE_PATH: ':memory:', NODE_ENV: 'development' })
const { ctx } = createServer(config)
if (!ctx.llm) {
  console.error('评测需要真实模型：请在 .env 中配置 LLM_API_KEY')
  process.exit(1)
}
const llm = ctx.llm
const today = localDate(new Date(), config.timeZone)
const cases = JSON.parse(readFileSync(path.join(REPO_ROOT, 'eval/cases.json'), 'utf8')) as Cases

const jobs: { group: Group; c: Case; strategy: Strategy }[] = [
  // Creating from nothing is the same task under both strategies (there is no base to patch).
  ...cases.create.map((c) => ({ group: 'create' as const, c, strategy: 'AB' as const })),
  ...(['evolve', 'illegal'] as const).flatMap((group) =>
    cases[group].flatMap((c) => (['A', 'B'] as const).map((strategy) => ({ group, c, strategy }))),
  ),
].filter((j) => !only || only.includes(j.c.id))

function outcomeOf(p: ProposalRecord): Outcome {
  if (p.status === 'pending') return 'pending'
  if (p.status === 'refused') return 'refused'
  return p.issues.some((i) => i.code.startsWith('SAFETY_')) ? 'blocked' : 'failed'
}

async function runJob(group: Group, c: Case, strategy: Strategy): Promise<EvalRun> {
  let appId: string | undefined
  let before: AppDefinition | null = null
  let records: StoredRecord[] = []
  if (c.base) {
    const t = getTemplate(c.base)
    const app = createApp(ctx, t.info.definition, { source: 'template', hasSampleData: true })
    seedRecords(ctx, app.id, resolveSamples(t.samples, today))
    appId = app.id
    before = app.definition
    records = listStored(ctx, app.id)
  }
  let error: string | null = null
  const started = Date.now()
  const saved = await runPlan(
    ctx,
    llm,
    { intent: c.intent, appId, strategy: strategy === 'A' ? 'regenerate' : 'patch' },
    (ev) => {
      if (ev.type === 'error') error = `${ev.code}: ${ev.message}`
    },
  )
  const base = {
    caseId: c.id,
    group,
    strategy,
    intent: c.intent,
    seeded: before ? records.length : null,
  }
  if (!saved) {
    return {
      ...base,
      outcome: 'error',
      rounds: 0,
      roundIssues: [],
      totalMs: Date.now() - started,
      tokens: null,
      preserved: null,
      destructive: null,
      unrelated: null,
      summary: null,
      error,
      output: null,
    }
  }
  const usage = saved.trace.rounds.map((r) => r.usage?.totalTokens)
  const after = saved.after
  const p = (saved.proposal ?? {}) as { summary?: string; reason?: string }
  return {
    ...base,
    outcome: outcomeOf(saved),
    rounds: saved.trace.rounds.length,
    roundIssues: saved.trace.rounds.map((r) => r.issues.map((i) => `${i.layer}:${i.code}`)),
    totalMs: saved.trace.totalMs,
    tokens: usage.every((u) => typeof u === 'number') ? usage.reduce((a, b) => a + b, 0) : null,
    preserved: before && after ? countPreserved(records, before, after) : null,
    destructive: before && after ? destructiveChanges(before, after) : null,
    unrelated: before && after ? unrelatedChanges(before, after, c.allowTouch ?? []) : null,
    summary: p.summary ?? p.reason ?? null,
    error,
    output: saved.proposal,
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i] as T)
      }
    }),
  )
  return out
}

// ── report ──────────────────────────────────────────────────────────────────
const frac = (a: number, b: number) => (b ? `${a}/${b}（${((a / b) * 100).toFixed(0)}%）` : '—')
const sec = (ms: number) => (Number.isNaN(ms) ? '—' : `${(ms / 1000).toFixed(1)} s`)

function stats(runs: EvalRun[], group: Group | 'normal') {
  const g = runs.filter((r) => (group === 'normal' ? r.group !== 'illegal' : r.group === group))
  const pending = g.filter((r) => r.outcome === 'pending')
  const rounds = g.flatMap((r) => r.roundIssues)
  const legalRounds = rounds.filter((iss) => !iss.some((x) => x.startsWith('schema:'))).length
  const tokens = g.map((r) => r.tokens).filter((t): t is number => t !== null)
  const ms = g.map((r) => r.totalMs)
  const withData = pending.filter((r) => r.seeded !== null)
  return {
    n: g.length,
    legal: frac(legalRounds, rounds.length),
    firstPass: frac(pending.filter((r) => r.rounds === 1).length, g.length),
    finalPass: frac(pending.length, g.length),
    preserved: frac(
      withData.reduce((a, r) => a + (r.preserved ?? 0), 0),
      withData.reduce((a, r) => a + (r.seeded ?? 0), 0),
    ),
    destructiveRuns: frac(withData.filter((r) => r.destructive?.length).length, withData.length),
    unrelated: withData.length
      ? `${withData.reduce((a, r) => a + (r.unrelated?.length ?? 0), 0)} 处（平均 ${(withData.reduce((a, r) => a + (r.unrelated?.length ?? 0), 0) / withData.length).toFixed(1)} / 提案）`
      : '—',
    blocked: frac(
      g.filter(
        (r) =>
          r.outcome === 'refused' ||
          r.outcome === 'blocked' ||
          (r.outcome === 'pending' && !r.destructive?.length),
      ).length,
      g.length,
    ),
    p50: sec(percentile(ms, 50)),
    p95: sec(percentile(ms, 95)),
    tokens: tokens.length
      ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length).toLocaleString('en-US')
      : '—',
  }
}

function markdown(runs: EvalRun[], meta: Record<string, string>): string {
  const by = (s: Strategy) => runs.filter((r) => r.strategy === s)
  const A = { evolve: stats(by('A'), 'evolve'), illegal: stats(by('A'), 'illegal') }
  const B = { evolve: stats(by('B'), 'evolve'), illegal: stats(by('B'), 'illegal') }
  const C = stats(by('AB'), 'create')
  const row = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`
  const detail = runs.map((r) =>
    [
      r.caseId,
      r.strategy,
      r.outcome,
      r.rounds,
      sec(r.totalMs),
      r.tokens ?? '—',
      r.seeded === null || r.preserved === null ? '—' : `${r.preserved}/${r.seeded}`,
      r.destructive?.length ? r.destructive.join('；') : r.destructive ? '0' : '—',
      r.unrelated?.length ? r.unrelated.join('；') : r.unrelated ? '0' : '—',
      (r.error ?? r.summary ?? '').replace(/\|/g, '/').slice(0, 80),
    ].join(' | '),
  )
  return `# 策略评测结果：A 整体重生成 vs B 增量 Patch

> 由 \`npm run eval -w @morphos/server\` 生成，所有数字均来自本次实际运行。指标定义与用例说明见 [eval/README.md](../README.md)。

| 项目 | 值 |
|---|---|
${Object.entries(meta)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

## 演进类（${A.evolve.n} 条用例 × 2 策略）

| 指标 | A 整体重生成 | B 增量 Patch |
|---|---|---|
${row('L1 结构合法率（按轮次）', A.evolve.legal, B.evolve.legal)}
${row('首轮通过率', A.evolve.firstPass, B.evolve.firstPass)}
${row('自修复后通过率（≤ 2 轮）', A.evolve.finalPass, B.evolve.finalPass)}
${row('数据保持率（通过的提案 × 已有记录）', A.evolve.preserved, B.evolve.preserved)}
${row('含破坏性 Schema 变更的提案', A.evolve.destructiveRuns, B.evolve.destructiveRuns)}
${row('无关修改', A.evolve.unrelated, B.evolve.unrelated)}
${row('延迟 P50 / P95', `${A.evolve.p50} / ${A.evolve.p95}`, `${B.evolve.p50} / ${B.evolve.p95}`)}
${row('平均 token / 次', A.evolve.tokens, B.evolve.tokens)}

## 非法 / 边界类（${A.illegal.n} 条用例 × 2 策略）

| 指标 | A 整体重生成 | B 增量 Patch |
|---|---|---|
${row('非法操作阻断率', A.illegal.blocked, B.illegal.blocked)}
${row('延迟 P50 / P95', `${A.illegal.p50} / ${A.illegal.p95}`, `${B.illegal.p50} / ${B.illegal.p95}`)}

## 创建类（${C.n} 条，两种策略任务相同，只跑一次）

| 指标 | 值 |
|---|---|
| L1 结构合法率（按轮次） | ${C.legal} |
| 首轮通过率 | ${C.firstPass} |
| 自修复后通过率（≤ 2 轮） | ${C.finalPass} |
| 延迟 P50 / P95 | ${C.p50} / ${C.p95} |
| 平均 token / 次 | ${C.tokens} |

## 逐条结果

| 用例 | 策略 | 结果 | 轮数 | 耗时 | token | 数据保持 | 破坏性变更 | 无关修改 | 摘要 / 错误 |
|---|---|---|---|---|---|---|---|---|---|
${detail.map((d) => `| ${d} |`).join('\n')}
`
}

// ── main ────────────────────────────────────────────────────────────────────
const t0 = Date.now()
console.log(`评测 ${jobs.length} 次运行 · 模型 ${llm.model} · 并发 ${concurrency}`)
const runs = await pool(jobs, concurrency, async (j) => {
  const r = await runJob(j.group, j.c, j.strategy)
  console.log(
    `  ${r.caseId} ${r.strategy.padEnd(2)} ${r.outcome.padEnd(8)} ${r.rounds} 轮 ${sec(r.totalMs).padStart(7)}` +
      `${r.preserved !== null ? ` 保持 ${r.preserved}/${r.seeded}` : ''}` +
      `${r.destructive?.length ? ` 破坏 ${r.destructive.length}` : ''}` +
      `${r.unrelated?.length ? ` 无关 ${r.unrelated.length}` : ''}${r.error ? ` ${r.error}` : ''}`,
  )
  return r
})

const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const meta = {
  模型: `${llm.model}（${new URL(config.llm.baseUrl).host}）`,
  提示词版本: `${PROMPT_VERSION}（A 为 ${PROMPT_VERSION}+regenerate-v1）`,
  温度: String(llm.temperature),
  自修复上限: '2 轮',
  日期: `${today}（${config.timeZone}）`,
  代码版本: `${git('rev-parse --short HEAD')}${git('status --porcelain') ? '（工作区有未提交改动）' : ''}`,
  运行次数: `${runs.length}（并发 ${concurrency}，总耗时 ${sec(Date.now() - t0)}）`,
}

const md = markdown(runs, meta)
if (only) {
  console.log(`\n${md}`)
} else {
  const dir = path.join(REPO_ROOT, 'eval/results')
  mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `${today}-${llm.model}`)
  writeFileSync(`${base}.json`, `${JSON.stringify({ meta, runs }, null, 2)}\n`)
  writeFileSync(`${base}.md`, md)
  console.log(`✓ 已写入 ${path.relative(REPO_ROOT, base)}.{json,md}`)
}
