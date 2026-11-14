import { createHash } from 'node:crypto'
import {
  constraintIssues,
  IntentBriefSchema,
  type PreparedIntent,
  type ProposalRecord,
  type ResolveIntentSchema,
  stableStringify,
  validateProposal,
  type z,
} from '@morphos/shared'
import { type Ctx, newId } from '../context'
import { audit, tx } from '../db'
import { HttpError, notFound } from '../errors'
import { getApp } from './apps'
import { activeConstraints } from './constraints'
import { parseModelJson, runPlan } from './planner'
import { getProposal } from './proposals'

interface BriefRow {
  id: string
  app_id: string | null
  base_version: number | null
  intent: string
  brief_json: string
  context_json: string
  signature: string
  parent_id: string | null
  created_at: string
  consumed_at: string | null
}
const publicBrief = (r: BriefRow): PreparedIntent => ({
  id: r.id,
  appId: r.app_id,
  baseVersion: r.base_version,
  intent: r.intent,
  brief: IntentBriefSchema.parse(JSON.parse(r.brief_json)),
  createdAt: r.created_at,
  resolution: (JSON.parse(r.context_json) as Pick<PreparedIntent, 'resolution'>).resolution,
})
function snapshot(ctx: Ctx, appId?: string) {
  const app = appId ? getApp(ctx, appId) : null
  const rules = appId ? activeConstraints(ctx, appId) : []
  const value = { version: app?.version ?? null, definition: app?.definition ?? null, rules }
  return { app, value, signature: createHash('sha256').update(stableStringify(value)).digest('hex') }
}

export async function prepareIntent(
  ctx: Ctx,
  input: { intent: string; appId?: string; parentId?: string },
  signal?: AbortSignal,
): Promise<PreparedIntent> {
  if (!ctx.llm) throw new HttpError(503, 'AI_UNAVAILABLE', '未配置模型，需求澄清与修复建议需要实时 AI')
  const before = snapshot(ctx, input.appId)
  const parent = input.parentId ? getProposal(ctx, input.parentId) : null
  if (
    parent &&
    (parent.appId !== (input.appId ?? null) || !['pending', 'invalid', 'refused'].includes(parent.status))
  )
    throw new HttpError(409, 'REPAIR_UNAVAILABLE', '原提案已处理或不属于此应用，请基于当前版本重新提出需求')
  const v = parent
    ? validateProposal(
        parent.proposal,
        before.app ? { current: { definition: before.app.definition, version: before.app.version } } : {},
      )
    : null
  const repair = parent
    ? {
        original: parent.proposal,
        issues: [
          ...(v?.issues ?? parent.issues),
          ...(v?.after ? constraintIssues(v.after, before.value.rules) : []),
        ],
      }
    : null
  const context = { ...before.value, intent: input.intent, repair }
  const instruction = `你是 MorphOS 的需求澄清助手。只输出 JSON，不输出代码，不生成应用定义。当前任务是准备可供人类确认的业务决策。
输出格式：{"summary":"理解的目标", "questions":[{"question":"问题", "reason":"为什么影响业务", "options":[{"label":"选择", "effect":"具体业务影响"}]}], "alternatives":[{"title":"方案名称", "approach":"实现思路", "tradeoff":"取舍"},{"title":"另一个方案", "approach":"实现思路", "tradeoff":"取舍"}]}。
questions 最多 3 项，每项 2–3 个互斥选择。仅对尚未明确且影响记录可见范围、写入权限、统计口径或业务流程的歧义追问；已经明确的要求不要重复问，普通布局自行决定。无歧义时 questions=[]。不得要求用户解除已确认约束。
这是一次增量需求分析，不是重新收集整个应用的需求。当前定义中的既有行为默认继承。先识别用户明确要求改变的范围，再判断这个范围内部是否有必须确认的业务歧义。用户说“保持统计口径/权限/字段/流程不变”，就已经回答了相关问题，不得再次追问，不得借优化界面扩展到去重、覆盖记录、容量限制或隐私策略。
能力边界：没有字段脱敏变换、唯一计数、自动去重、重复覆盖、按人鉴权、容量限制、真实消息发送。这些不能出现在问题选项或方案中。可以调整显示标题、布局；可通过已有字段筛选记录；可通过表格 columns 限定可见字段；通过 QuickAction 的 set/ask/availableWhen 限定预设操作。不能修改已有业务记录。
明确要求保持不变的键优先于方案措辞：参数不变包括 Metric.params.label 等显示参数；只改组件 title 不代表可以改 params.label。应用名称不变时不能建议改名。不要把视觉优化扩大到状态、排序、分页或筛选。
例一：用户“只调整标题和排列，权限和统计不变” → questions 必须为空，两个方案只能在标题和排列上有区别。
例二：用户“为协助者生成操作页面”，但未说明可看哪些字段、可改哪些字段 → 可追问这两个范围，只列出当前协议可实现且不违反长期规则的选项。
例三：用户“报名页只提交表单，不看其他人的信息” → 不要问是否展示名单，更不要问是否对现有数据去重；现有表单流程保持不变。
alternatives 必须恰好两个，围绕同一目标给出实质不同但遵守约束的实现取舍，不能把违法规则的方案当成可选项。这里只是建议，尚未验证，不保证可实现。
若 repair 不为空，解释原提案的具体冲突，优先局部修复、保留业务目标和无关组件，必须披露需要收缩的功能；不能声称已修复或数学意义上最小，不能清空记录。协议只支持单实体、表单、表格、筛选、指标、图表、快捷操作、消息草稿和 CSV 导出，不支持逐人登录鉴权、真实发送或任意代码。`
  const response = await ctx.llm.chat(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify(context) },
    ],
    { json: true, signal },
  )
  const parsed = parseModelJson(response.content)
  const validated = IntentBriefSchema.safeParse(parsed.ok ? parsed.value : null)
  if (!validated.success)
    throw new HttpError(422, 'BRIEF_INVALID', 'AI 未返回有效的澄清与方案，请重试；应用没有改动')
  if (snapshot(ctx, input.appId).signature !== before.signature)
    throw new HttpError(409, 'VERSION_CONFLICT', '准备期间应用或业务规则已变化，请重新分析需求')
  if (signal?.aborted) throw new HttpError(409, 'PREPARATION_CANCELLED', '已取消需求分析')
  const id = newId('brief')
  const at = ctx.now().toISOString()
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        'INSERT INTO intent_briefs (id, app_id, base_version, intent, brief_json, context_json, signature, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.appId ?? null,
        before.app?.version ?? null,
        input.intent,
        JSON.stringify(validated.data),
        JSON.stringify(context),
        before.signature,
        parent?.id ?? null,
        at,
      )
    audit(
      ctx.db,
      input.appId ?? null,
      'intent.prepared',
      {
        briefId: id,
        parentId: parent?.id,
        model: ctx.llm?.model,
        promptVersion: 'brief-v1.2',
        system: instruction,
        output: response.content,
        reasoning: response.reasoning,
        usage: response.usage,
      },
      ctx.now(),
    )
  })
  return {
    id,
    appId: input.appId ?? null,
    baseVersion: before.app?.version ?? null,
    intent: input.intent,
    brief: validated.data,
    createdAt: at,
  }
}

export function getBrief(ctx: Ctx, id: string) {
  const row = ctx.db.prepare('SELECT * FROM intent_briefs WHERE id = ?').get(id) as BriefRow | undefined
  if (!row) throw notFound('需求确认')
  if (row.app_id) getApp(ctx, row.app_id)
  return publicBrief(row)
}

export async function generateOptions(
  ctx: Ctx,
  input: z.infer<typeof ResolveIntentSchema>,
  signal?: AbortSignal,
) {
  if (!ctx.llm) throw new HttpError(503, 'AI_UNAVAILABLE', '未配置实时模型')
  const row = ctx.db.prepare('SELECT * FROM intent_briefs WHERE id = ?').get(input.briefId) as
    | BriefRow
    | undefined
  if (!row) throw notFound('需求确认')
  const prepared = publicBrief(row)
  if (snapshot(ctx, row.app_id ?? undefined).signature !== row.signature)
    throw new HttpError(409, 'VERSION_CONFLICT', '应用或规则已变化，请重新分析并确认需求')
  if (row.consumed_at)
    throw new HttpError(409, 'BRIEF_CONSUMED', '此需求已生成过方案，请查看提案历史或重新分析')
  if (
    input.answers.length !== prepared.brief.questions.length ||
    input.answers.some((a, i) => !prepared.brief.questions[i]?.options[a])
  )
    throw new HttpError(422, 'ANSWERS_REQUIRED', '请逐项明确选择业务含义后再生成')
  if (row.parent_id && !['pending', 'invalid', 'refused'].includes(getProposal(ctx, row.parent_id).status))
    throw new HttpError(409, 'REPAIR_UNAVAILABLE', '原提案已处理，请重新分析需求')
  tx(ctx.db, () => {
    const result = ctx.db
      .prepare(
        'UPDATE intent_briefs SET consumed_at = ?, context_json = ? WHERE id = ? AND consumed_at IS NULL',
      )
      .run(
        ctx.now().toISOString(),
        JSON.stringify({
          ...JSON.parse(row.context_json),
          resolution: { answers: input.answers, choice: input.choice },
        }),
        row.id,
      )
    if (!result.changes) throw new HttpError(409, 'BRIEF_CONSUMED', '此需求正在生成，请勿重复提交')
    audit(
      ctx.db,
      row.app_id,
      'intent.confirmed',
      { briefId: row.id, answers: input.answers, choice: input.choice },
      ctx.now(),
    )
  })
  const proposals: ProposalRecord[] = []
  const failures: string[] = []
  const choices = input.choice === 'compare' ? [0, 1] : [input.choice]
  for (const index of choices) {
    if (signal?.aborted) break
    if (snapshot(ctx, row.app_id ?? undefined).signature !== row.signature) {
      failures.push('应用或规则已变化，后续方案已停止')
      break
    }
    const option = prepared.brief.alternatives[index]
    if (!option) continue
    const guidance = `人类确认的需求分析：${prepared.brief.summary}\n明确选择：${JSON.stringify(prepared.brief.questions.map((q, i) => ({ question: q.question, answer: q.options[input.answers[i] ?? -1] })))}\n本次选用方案：${JSON.stringify(option)}\n${row.parent_id ? `局部修复任务：${row.context_json}\n只修改解决冲突必需的部分，保留原始目标和其他组件，必须在 summary 说明功能取舍；不能解除规则。` : '实现当前方案，保留未要求更改的功能。'}\n方案描述只是待验证建议；必须遵守现有协议与业务约束。`
    const saved = await runPlan(
      ctx,
      ctx.llm,
      {
        intent: row.intent,
        appId: row.app_id ?? undefined,
        expectedVersion: row.base_version ?? undefined,
        guidance,
        groupId: row.id,
        parentId: row.parent_id ?? undefined,
        optionLabel: option.title,
      },
      (ev) => {
        if (ev.type === 'error') failures.push(ev.message)
      },
      signal,
    )
    if (saved) proposals.push(saved)
  }
  return { proposals, failures, brief: prepared }
}
