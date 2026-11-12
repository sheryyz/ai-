/**
 * Role-view evaluation (requirements.md §8 revision 6, eval/README.md): the "view" group of
 * eval/cases.json against the live model configured in .env.
 *
 *   npm run eval:views -w @morphos/server                    full run → eval/results/<date>-<model>-views.{json,md}
 *   npm run eval:views -w @morphos/server -- --only=v01,v07  smoke run, printed only, nothing written
 *
 * What each view exposes is computed by computeExposure on the definition that would be in effect —
 * never taken from the model's summary. Every number in the output comes from this run.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type AppDefinition, localDate, validateDefinition, validateProposal } from '@morphos/shared'
import { createApp as createServer } from '../app'
import { loadEnvFile, parseConfig, REPO_ROOT } from '../config'
import { PROMPT_VERSION } from '../llm/prompt'
import { createApp } from '../services/apps'
import { runPlan } from '../services/planner'
import { seedRecords } from '../services/records'
import { getTemplate, resolveSamples } from '../services/templates'
import { checkViewCase, percentile, type ViewCheck, type ViewExpect } from './eval-metrics'

interface ViewCase {
  id: string
  base: string
  setup?: string[]
  intent: string
  target: string
  forbid?: string[]
  expect: ViewExpect & { outcome?: string[] }
}
type Outcome = 'pending' | 'refused' | 'blocked' | 'failed' | 'error'

interface ViewRun {
  caseId: string
  base: string
  intent: string
  outcome: Outcome
  allowedOutcome: boolean
  rounds: number
  roundIssues: string[][]
  warnings: string[]
  totalMs: number
  tokens: number | null
  confirmExposure: boolean | null
  check: ViewCheck
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
const read = (p: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, p), 'utf8'))
const cases = (read('eval/cases.json').view as ViewCase[]).filter((c) => !only || only.includes(c.id))

/** Base app: a built-in template with its fictional sample records, or a hand-written eval base (no records). */
function startingApp(c: ViewCase): { appId: string; before: AppDefinition } {
  const template =
    c.base === 'event-registration' || c.base === 'equipment-lending' ? getTemplate(c.base) : null
  let def = (
    template
      ? template.info.definition
      : validateDefinition(read(`eval/bases/${c.base}.json`).definition).definition
  ) as AppDefinition
  for (const f of c.setup ?? []) {
    const r = validateProposal(
      { ...read(`fixtures/${f}`), baseVersion: 1 },
      { current: { definition: def, version: 1 } },
    )
    if (!r.ok || !r.after) throw new Error(`${c.id}: setup ${f} invalid`)
    def = r.after
  }
  const app = createApp(ctx, def, { source: 'template', hasSampleData: Boolean(template) })
  if (template) seedRecords(ctx, app.id, resolveSamples(template.samples, today))
  return { appId: app.id, before: app.definition }
}

async function runCase(c: ViewCase): Promise<ViewRun> {
  const { appId, before } = startingApp(c)
  let error: string | null = null
  const started = Date.now()
  const saved = await runPlan(ctx, llm, { intent: c.intent, appId }, (ev) => {
    if (ev.type === 'error') error = `${ev.code}: ${ev.message}`
  })
  const outcome: Outcome = !saved
    ? 'error'
    : saved.status === 'pending'
      ? 'pending'
      : saved.status === 'refused'
        ? 'refused'
        : saved.issues.some((i) => i.code.startsWith('SAFETY_'))
          ? 'blocked'
          : 'failed'
  // The definition in effect afterwards: the proposal's result if it could be approved, else the base.
  const resulting = outcome === 'pending' && saved?.after ? saved.after : before
  const confirmExposure = outcome === 'pending' ? (saved?.diff?.confirmExposure ?? null) : null
  const usage = saved?.trace.rounds.map((r) => r.usage?.totalTokens) ?? []
  const p = (saved?.proposal ?? {}) as { summary?: string; reason?: string }
  return {
    caseId: c.id,
    base: c.base,
    intent: c.intent,
    outcome,
    allowedOutcome: (c.expect.outcome ?? ['pending']).includes(outcome),
    rounds: saved?.trace.rounds.length ?? 0,
    roundIssues: saved?.trace.rounds.map((r) => r.issues.map((i) => `${i.layer}:${i.code}`)) ?? [],
    warnings: saved?.issues.filter((i) => i.level === 'warning').map((i) => i.code) ?? [],
    totalMs: saved?.trace.totalMs ?? Date.now() - started,
    tokens:
      usage.length && usage.every((u) => typeof u === 'number') ? usage.reduce((a, b) => a + b, 0) : null,
    confirmExposure,
    check: checkViewCase(before, resulting, confirmExposure, c.target, c.forbid ?? [], c.expect),
    summary: p.summary ?? p.reason ?? null,
    error,
    output: saved?.proposal ?? null,
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
const list = (xs: string[] | undefined) => (xs?.length ? xs.join('、') : '—')

function markdown(runs: ViewRun[], meta: Record<string, string>): string {
  const withForbid = runs.filter((r) => r.check.forbidHeld !== null)
  const withConfirm = runs.filter((r) => r.check.checks.some((c) => c.name === 'confirm'))
  const tokens = runs.map((r) => r.tokens).filter((t): t is number => t !== null)
  const ms = runs.map((r) => r.totalMs)
  const rows = runs.map((r) =>
    [
      r.caseId,
      r.base,
      r.outcome,
      r.rounds,
      sec(r.totalMs),
      list(r.check.exposure?.read),
      list(r.check.exposure?.write),
      list(r.check.exposure?.restricted),
      r.confirmExposure === null ? '—' : r.confirmExposure ? '需要' : '不需要',
      r.check.checks
        .filter((c) => !c.ok)
        .map((c) => c.name)
        .join('、') || '✓',
      (r.error ?? r.summary ?? '').replace(/\|/g, '/').slice(0, 70),
    ].join(' | '),
  )
  return `# 角色视图评测结果

> 由 \`npm run eval:views -w @morphos/server\` 生成，所有数字均来自本次实际运行。用例与指标定义见 [eval/README.md](../README.md)。
> 每个分享页能看到 / 修改什么由 \`computeExposure\` 在结果定义上计算，不采信模型的描述。

| 项目 | 值 |
|---|---|
${Object.entries(meta)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

## 汇总（${runs.length} 条用例，其中演示以外领域 ${runs.filter((r) => !r.base.startsWith('event-')).length} 条）

| 指标 | 值 |
|---|---|
| 结果符合预期（得到可批准的提案；越界用例允许拒绝） | ${frac(runs.filter((r) => r.allowedOutcome).length, runs.length)} |
| 首轮通过 | ${frac(runs.filter((r) => r.outcome === 'pending' && r.rounds === 1).length, runs.length)} |
| 暴露正确率（结果符合预期且全部暴露期望成立） | ${frac(runs.filter((r) => r.allowedOutcome && r.check.correct).length, runs.length)} |
| 禁令守住率（被禁止的字段没有进入该分享页） | ${frac(withForbid.filter((r) => r.check.forbidHeld).length, withForbid.length)} |
| 禁令写入约束（被禁止的字段记入 restrictedFields） | ${frac(withForbid.filter((r) => r.check.restrictionRecorded).length, withForbid.length)} |
| 是否需要公开确认判断正确 | ${frac(withConfirm.filter((r) => r.check.checks.find((c) => c.name === 'confirm')?.ok).length, withConfirm.length)} |
| 延迟 P50 / P95 | ${sec(percentile(ms, 50))} / ${sec(percentile(ms, 95))} |
| 平均 token / 次 | ${tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length).toLocaleString('en-US') : '—'} |

## 逐条结果

| 用例 | 起点 | 结果 | 轮数 | 耗时 | 逐条可见 | 可写 | 禁止接触 | 公开确认 | 未满足的期望 | 摘要 / 错误 |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.map((d) => `| ${d} |`).join('\n')}

## 用例原文

${runs.map((r) => `- **${r.caseId}**（${r.base}）${r.intent}${r.roundIssues.some((x) => x.length) ? `　校验问题：${r.roundIssues.map((x, i) => `第 ${i + 1} 轮 ${x.join('、') || '无'}`).join('；')}` : ''}`).join('\n')}
`
}

// ── main ────────────────────────────────────────────────────────────────────
const t0 = Date.now()
console.log(`角色视图评测 ${cases.length} 条 · 模型 ${llm.model} · 并发 ${concurrency}`)
const runs = await pool(cases, concurrency, async (c) => {
  const r = await runCase(c)
  const failed = r.check.checks.filter((x) => !x.ok).map((x) => x.name)
  console.log(
    `  ${r.caseId} ${r.outcome.padEnd(8)} ${r.rounds} 轮 ${sec(r.totalMs).padStart(7)}` +
      ` read[${r.check.exposure?.read.join(',') ?? ''}] write[${r.check.exposure?.write.join(',') ?? ''}]` +
      ` restricted[${r.check.exposure?.restricted.join(',') ?? ''}]${failed.length ? ` ✗ ${failed.join(',')}` : ' ✓'}` +
      `${r.error ? ` ${r.error}` : ''}`,
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
  提示词版本: PROMPT_VERSION,
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
  const base = path.join(dir, `${today}-${llm.model}-views`)
  writeFileSync(`${base}.json`, `${JSON.stringify({ meta, runs }, null, 2)}\n`)
  writeFileSync(`${base}.md`, md)
  console.log(`✓ 已写入 ${path.relative(REPO_ROOT, base)}.{json,md}`)
}
