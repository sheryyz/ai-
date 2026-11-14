/** Authorized opt-in benchmark: synthetic records, isolated memory DB, at most 18 live calls. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  computeDiff,
  constraintIssues,
  explainNode,
  stableStringify,
  validateDefinition,
  validateProposal,
} from '@morphos/shared'
import { createApp } from '../app'
import { loadEnvFile, parseConfig, REPO_ROOT } from '../config'
import { createApp as createBusinessApp, getApp } from '../services/apps'
import { activeConstraints, addConstraint } from '../services/constraints'
import { generateOptions, prepareIntent } from '../services/guidance'
import { previewProposal } from '../services/impact'
import { proposePhase, savePhase } from '../services/phases'
import { approveProposal, getProposal, saveProposal } from '../services/proposals'
import { createRecord, listStored } from '../services/records'
import { getTemplate } from '../services/templates'

loadEnvFile()
const { ctx } = createApp(parseConfig({ ...process.env, NODE_ENV: 'test', DATABASE_PATH: ':memory:' }))
const model = ctx.llm
if (!model) throw new Error('需要配置真实模型')
const maxCalls = Number(process.argv.find((a) => a.startsWith('--max-calls='))?.split('=')[1] ?? 18)
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 18)
  throw new Error('max-calls 必须在 1–18 之间')
const followUp = process.argv.includes('--follow-up')
let calls = 0
ctx.llm = {
  ...model,
  chat: (messages, options) => {
    if (calls >= maxCalls) throw new Error('已达到本次授权的 18 次上限')
    calls++
    return model.chat(messages, options)
  },
}
const report: { id: string; passed: boolean; detail: unknown }[] = []
async function check(id: string, run: () => Promise<{ passed: boolean; detail: unknown }>) {
  try {
    const result = await run()
    report.push({ id, ...result })
    console.log(JSON.stringify({ id, passed: result.passed, calls }))
  } catch (error) {
    report.push({ id, passed: false, detail: error instanceof Error ? error.message : String(error) })
    console.log(JSON.stringify({ id, passed: false, calls }))
  }
}
try {
  for (const template of ['event-registration', 'equipment-lending'] as const)
    await check(`compare-${template}`, async () => {
      const app = createBusinessApp(ctx, getTemplate(template).info.definition, { source: 'template' })
      const before = stableStringify(listStored(ctx, app.id))
      const prepared = await prepareIntent(ctx, {
        appId: app.id,
        intent:
          '仅优化管理页面的信息呈现。请给出两种组件标题或布局方案。应用名称和图标必须不变；params 中包括 label 在内的每个键值都必须不变。保留所有字段、组件、数据绑定、参数、统计口径和权限；不新增分享页面，不改变业务记录。只允许修改标题、应用说明或组件位置。',
      })
      if (prepared.brief.questions.length)
        return { passed: false, detail: { reason: '明确范围仍被追问，本用例不自动代答', prepared } }
      const generated = await generateOptions(ctx, { briefId: prepared.id, answers: [], choice: 'compare' })
      const presentationFree = (definition: typeof app.definition) => ({
        ...definition,
        description: '',
        nodes: definition.nodes.map(
          ({ title: _title, region: _region, order: _order, width: _width, ...node }) => node,
        ),
      })
      const withinScope = generated.proposals.every(
        (p) =>
          p.after &&
          stableStringify(presentationFree(p.after)) === stableStringify(presentationFree(app.definition)),
      )
      const previews = generated.proposals
        .filter((p) => p.status === 'pending')
        .map((p) => previewProposal(ctx, p.id))
      let oneOnly = false
      const first = generated.proposals[0]
      const second = generated.proposals[1]
      if (withinScope && first?.status === 'pending' && second?.status === 'pending') {
        // Explicit benchmark policy: approve A only in this synthetic database, never on behalf of a real user.
        approveProposal(ctx, first.id, { previewToken: previews[0]?.previewToken })
        oneOnly = getProposal(ctx, second.id).status === 'rejected' && getApp(ctx, app.id).version === 2
      }
      return {
        passed:
          generated.proposals.length === 2 &&
          withinScope &&
          oneOnly &&
          before === stableStringify(listStored(ctx, app.id)),
        detail: { prepared, generated, withinScope, oneOnly, previews },
      }
    })
  if (!followUp)
    await check('consequential-clarification', async () => {
      const app = createBusinessApp(ctx, getTemplate('event-registration').info.definition, {
        source: 'template',
      })
      const prepared = await prepareIntent(ctx, {
        appId: app.id,
        intent: '让大家都能处理报名信息，方便现场使用。',
      })
      return {
        passed: prepared.brief.questions.length > 0 && getApp(ctx, app.id).version === 1,
        detail: { prepared, note: '只检验模型提出待确认问题且未执行；问题质量需人工审阅，不自动选择答案。' },
      }
    })
  const read = (file: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures', file), 'utf8'))
  let definition = validateDefinition(read('templates/event-registration.json')).definition
  if (!definition) throw new Error('模板无效')
  for (const [i, file] of [
    'proposals/event-checkin.patch.json',
    'proposals/event-desk.patch.json',
  ].entries()) {
    const result = validateProposal(read(file), { current: { definition, version: i + 1 } })
    if (!result.after) throw new Error('样例无效')
    definition = result.after
  }
  const app = createBusinessApp(ctx, definition, { source: 'template' })
  for (let n = 0; n < 6; n++)
    createRecord(ctx, app.id, 'signup', { name: `虚构验收${n}`, studentId: `DEMO-${n}`, major: '计算机' })
  const before = stableStringify(listStored(ctx, app.id))
  const raw = {
    kind: 'patch',
    baseVersion: 1,
    intent: '允许志愿者核对并修改姓名，同时把签到按钮标题改为现场签到',
    summary: '增加姓名修改',
    operations: [{ op: 'updateNode', nodeId: 'deskAction', title: '现场签到', params: { ask: ['name'] } }],
  }
  const validated = validateProposal(raw, { current: { definition, version: 1 } })
  if (!validated.ok || !validated.after) throw new Error('冲突前的手工提案无效')
  const original = saveProposal(ctx, {
    appId: app.id,
    baseVersion: 1,
    kind: 'patch',
    origin: 'manual',
    intent: raw.intent,
    proposal: raw,
    status: 'pending',
    issues: [],
    after: validated.after,
    diff: computeDiff(definition, validated.after, { fromVersion: 1, recordCount: 6 }),
    trace: {
      origin: 'manual',
      model: '人工构造冲突用例',
      promptVersion: 'eval-v1',
      temperature: null,
      context: '人工构造的待批准提案，不是模型产出',
      rounds: [],
      totalMs: 0,
      notes: [],
    },
  })
  addConstraint(ctx, app.id, 1, '志愿者仅能签到', {
    kind: 'allowedWrites',
    viewId: 'desk',
    fields: ['checkedIn'],
  })
  await check('local-conflict-repair', async () => {
    const prepared = await prepareIntent(ctx, {
      appId: app.id,
      parentId: original.id,
      intent:
        '修复原提案与持续规则的冲突：志愿者仅允许修改签到状态，禁止修改姓名。保留原提案将 deskAction.title 改为“现场签到”的有效变更，只移除原提案中询问并修改姓名的违规变更，保留原有签到能力；不调整其他组件、字段、布局、权限或数据。',
    })
    if (prepared.brief.questions.length)
      return { passed: false, detail: { reason: '留待人工回答，不自动代答', prepared } }
    const generated = await generateOptions(ctx, { briefId: prepared.id, answers: [], choice: 0 })
    const candidate = generated.proposals[0]
    const safe = Boolean(
      candidate?.after && constraintIssues(candidate.after, activeConstraints(ctx, app.id)).length === 0,
    )
    return {
      passed:
        candidate?.status === 'pending' &&
        safe &&
        getApp(ctx, app.id).version === 1 &&
        before === stableStringify(listStored(ctx, app.id)),
      detail: {
        prepared,
        generated,
        safe,
        note: '局部性请结合 operations 人工审阅；不声称数学上的最小修复。',
      },
    }
  })
  await check('execution-grounded-explanation', async () => {
    const result = explainNode(definition, listStored(ctx, app.id), 'rate', { today: '2026-11-14' })
    return { passed: result?.total === 6 && result.result === 0 && result.matched === 0, detail: result }
  })
  await check('human-phase-data-preservation', async () => {
    const phase = savePhase(ctx, app.id, { baseVersion: 1, name: '报名结束', disabledNodes: ['signup'] })
    const proposal = proposePhase(ctx, app.id, phase.id)
    const preview = previewProposal(ctx, proposal.id)
    approveProposal(ctx, proposal.id, { previewToken: preview.previewToken })
    let blocked = false
    try {
      createRecord(ctx, app.id, 'signup', { name: '不应写入', studentId: 'X', major: '计算机' })
    } catch {
      blocked = true
    }
    return {
      passed:
        blocked &&
        before === stableStringify(listStored(ctx, app.id)) &&
        activeConstraints(ctx, app.id).length === 1,
      detail: {
        phase,
        preview,
        blocked,
        recordCount: listStored(ctx, app.id).length,
        note: '测试程序模拟人工批准，作用域仅限内存测试库。',
      },
    }
  })
} finally {
  const dir = path.join(REPO_ROOT, 'eval/results')
  mkdirSync(dir, { recursive: true })
  const filename = `innovations-${Date.now()}.json`
  writeFileSync(
    path.join(dir, filename),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: model.model,
        protocol: followUp ? 'follow-up-v2-explicit-scope-and-nonempty-repair' : 'initial-v1',
        calls,
        note: '单次小样本工程验收；真实模型预检和生成，人工构造冲突输入，确定性引擎解释与阶段操作；虚构数据；不代表泛化成功率。',
        report,
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      output: filename,
      passed: report.filter((r) => r.passed).length,
      total: report.length,
      calls,
    }),
  )
  ctx.db.close()
}
