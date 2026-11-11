/**
 * Records real model responses for offline demo mode (fixtures/recorded/).
 * Runs the actual planner pipeline against the live model on an in-memory database, approving each
 * proposal so the next step is planned against exactly the definition the demo will have.
 *
 *   npm run record-demos -w @morphos/server        (requires LLM_API_KEY in .env)
 *
 * Output files contain model text, reasoning, usage and timing only — never the API key.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProposalRecord } from '@morphos/shared'
import { createApp } from '../app'
import { loadEnvFile, parseConfig } from '../config'
import type { Recording } from '../llm/replay'
import { RECORDINGS_DIR } from '../llm/replay'
import { getApp } from '../services/apps'
import { runPlan } from '../services/planner'
import { approveProposal } from '../services/proposals'
import { createRecord } from '../services/records'

loadEnvFile()
const config = parseConfig({ ...process.env, DATABASE_PATH: ':memory:', NODE_ENV: 'development' })
const { ctx } = createApp(config)
if (!ctx.llm) {
  console.error('需要在 .env 中配置 LLM_API_KEY 才能录制演示样例')
  process.exit(1)
}
const llm = ctx.llm

interface Step {
  id: string
  title: string
  intent: string
  /** Which earlier step's app to evolve; omitted for create. */
  on?: string
  approve: boolean
}

const STEPS: Step[] = [
  {
    id: '01-event-create',
    title: '场景 A · 创建讲座报名系统',
    intent: '创建一个校园讲座报名系统，包含姓名、学号、专业、手机号。',
    approve: true,
  },
  {
    id: '02-event-checkin',
    title: '场景 A · 加签到、未签到提醒与签到率',
    intent: '活动快开始了，加一个签到功能，找出计算机专业还没签到的人，给他们写提醒，旁边显示签到率。',
    on: '01-event-create',
    approve: true,
  },
  {
    id: '03-event-delete',
    title: '场景 A · 非法意图：删除未签到人员',
    intent: '把没签到的人从名单里删掉并重置数据',
    on: '01-event-create',
    approve: false,
  },
  {
    id: '04-equipment-create',
    title: '场景 B · 创建设备借用管理',
    intent: '设备借用管理：设备名称、编号、类别、状态（可借用/已借出/已归还）、借用人、借用日期。',
    approve: true,
  },
]

/** A few generic records so evolution prompts see realistic statistics (fictional values). */
function seed(appId: string) {
  const app = getApp(ctx, appId)
  const form = app.definition.nodes.find((n) => n.type === 'Form')
  if (!form) return
  const entity = app.definition.entities[0]
  const fields = (form.params as { fields: string[] }).fields
  for (let i = 0; i < 8; i++) {
    const values: Record<string, unknown> = {}
    for (const id of fields) {
      const f = entity?.fields.find((x) => x.id === id)
      if (!f) continue
      if (f.type === 'enum') values[id] = f.options?.[i % (f.options?.length ?? 1)]
      else if (f.type === 'number') values[id] = i + 1
      else if (f.type === 'boolean') values[id] = false
      else if (f.type === 'date') values[id] = '2026-11-10'
      else values[id] = `${f.label}${i + 1}`
    }
    createRecord(ctx, appId, form.id, values)
  }
}

mkdirSync(RECORDINGS_DIR, { recursive: true })
const apps = new Map<string, string>()

for (const step of STEPS) {
  const appId = step.on ? apps.get(step.on) : undefined
  if (step.on && !appId) throw new Error(`step ${step.on} did not produce an app`)
  const base = appId ? getApp(ctx, appId) : null
  process.stdout.write(`▶ ${step.id} … `)
  const saved: ProposalRecord | null = await runPlan(ctx, llm, { intent: step.intent, appId }, (ev) => {
    if (ev.type === 'issues') process.stdout.write(`[round ${ev.round}: ${ev.issues.length} issue(s)] `)
    if (ev.type === 'error') process.stdout.write(`[${ev.code}: ${ev.message}] `)
  })
  if (!saved) throw new Error(`${step.id}: model call failed`)
  console.log(`${saved.status} · ${saved.trace.rounds.length} round(s) · ${saved.trace.totalMs} ms`)

  const rec: Recording = {
    id: step.id,
    title: step.title,
    kind: saved.kind,
    intent: step.intent,
    model: saved.trace.model,
    recordedAt: new Date().toISOString(),
    promptVersion: saved.trace.promptVersion,
    temperature: saved.trace.temperature,
    base: base ? { version: base.version, definition: base.definition } : null,
    rounds: saved.trace.rounds.map(({ reasoning, content, usage, finishReason, ms }) => ({
      reasoning,
      content,
      usage,
      finishReason,
      ms,
    })),
  }
  writeFileSync(path.join(RECORDINGS_DIR, `${step.id}.json`), `${JSON.stringify(rec, null, 2)}\n`)

  if (step.approve) {
    if (saved.status !== 'pending')
      throw new Error(`${step.id}: expected a pending proposal, got ${saved.status}`)
    const r = approveProposal(ctx, saved.id)
    apps.set(step.id, r.appId)
    if (!step.on) seed(r.appId)
  }
}
console.log(`✓ 已写入 ${RECORDINGS_DIR}`)
