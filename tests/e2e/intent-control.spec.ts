/** Scripted model, real HTTP services/SQLite/production UI. This is regression coverage, not a live-model benchmark. */

import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import path from 'node:path'
import { validateDefinition, validateProposal } from '@morphos/shared'
import { createApp } from '../../apps/server/src/app'
import { parseConfig, REPO_ROOT } from '../../apps/server/src/config'
import { createApp as createBusinessApp } from '../../apps/server/src/services/apps'
import { addConstraint } from '../../apps/server/src/services/constraints'
import { runPlan } from '../../apps/server/src/services/planner'
import { createRecord } from '../../apps/server/src/services/records'
import { scripted } from '../../apps/server/src/test-utils'
import { expect, test } from './fixtures'

function withDesk() {
  const read = (name: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures', name), 'utf8'))
  let definition = validateDefinition(read('templates/event-registration.json')).definition
  if (!definition) throw new Error('invalid template')
  for (const [i, file] of [
    'proposals/event-checkin.patch.json',
    'proposals/event-desk.patch.json',
  ].entries()) {
    const result = validateProposal(read(file), { current: { definition, version: i + 1 } })
    if (!result.after || !result.ok) throw new Error(`invalid fixture ${file}`)
    definition = result.after
  }
  return definition
}

const brief = {
  summary: '优化现场操作的呈现方式',
  questions: [
    {
      question: '保留当前权限范围吗？',
      reason: '避免无意扩大操作权限',
      options: [
        { label: '保留现有边界', effect: '只调整呈现' },
        { label: '先讨论新的范围', effect: '暂不执行权限变更' },
      ],
    },
  ],
  alternatives: [
    { title: '突出操作标题', approach: '调整操作标题', tradeoff: '对页面改动较小' },
    { title: '完善应用说明', approach: '补充使用说明', tradeoff: '需要阅读说明' },
  ],
}
const patch = (description: string, baseVersion: number) => ({
  kind: 'patch',
  baseVersion,
  intent: '优化界面',
  summary: description,
  operations: [{ op: 'updateApp', description }],
})
const model = scripted([
  brief,
  patch('方案 A 的使用说明', 1),
  patch('方案 B 的使用说明', 1),
  {
    ...brief,
    summary: '原提案要求修改姓名，与只允许签到的规则冲突；建议保留规则并补充核对说明。',
    questions: [],
    alternatives: [
      { title: '保留权限补充说明', approach: '保持姓名只读，仅补充说明', tradeoff: '不能直接改名' },
      { title: '保持原状', approach: '拒绝扩大权限', tradeoff: '不会新增修改能力' },
    ],
  },
  patch('姓名保持只读，志愿者核对后只执行签到', 2),
])
const instance = createApp(
  parseConfig({
    NODE_ENV: 'production',
    DATABASE_PATH: ':memory:',
    LLM_API_KEY: 'scripted-local-test',
    LLM_MODEL: 'scripted-test-model',
  }),
  { llm: model, replaySpeed: 0 },
)
let server: Server
let base = ''
let appId = ''

test.use({ authBaseURL: { url: () => base } })

test.beforeAll(async () => {
  const app = createBusinessApp(instance.ctx, withDesk(), { source: 'manual' })
  appId = app.id
  for (let i = 0; i < 6; i++)
    createRecord(instance.ctx, appId, 'signup', {
      name: `验收${i}`,
      studentId: `2026${i}`,
      major: i < 3 ? '计算机' : '其他',
    })
  await new Promise<void>((resolve) => {
    server = instance.app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no port')
  base = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  instance.ctx.db.close()
})

test('澄清 → 双方案 → 局部修复 → 来源解释 → 阶段停用，全程保持记录', async ({ page, request }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/apps/${appId}/studio`)
  await page.getByRole('textbox', { name: '描述你的需求' }).fill('优化现场操作的呈现方式')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('先确认业务含义')
  await expect(dialog.getByRole('button', { name: '生成两个方案并比较' })).toBeDisabled()
  await dialog.getByRole('radio', { name: /保留现有边界/ }).check()
  await page.screenshot({ path: info.outputPath('clarification.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  const mobileDialog = await dialog.boundingBox()
  expect(mobileDialog?.y).toBeGreaterThanOrEqual(0)
  expect((mobileDialog?.y ?? 0) + (mobileDialog?.height ?? 0)).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath('clarification-mobile-dark.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await dialog.getByRole('button', { name: '生成两个方案并比较' }).click()
  await expect(dialog).toBeHidden()
  const comparison = page.getByRole('region', { name: '候选方案比较' })
  await expect(comparison).toContainText('突出操作标题')
  await expect(comparison).toContainText('完善应用说明')
  await comparison.getByRole('button', { name: '展开并排对比' }).click()
  await expect(dialog).toContainText('比较候选方案')
  await expect(dialog.getByRole('button', { name: '选择并查看完整变更' })).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('comparison.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '选择并查看完整变更' }).first().click()
  await page.reload()
  await expect(comparison).toContainText('突出操作标题')
  await comparison.getByText('查看已确认的业务含义', { exact: true }).click()
  await expect(comparison).toContainText('保留现有边界')
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('已生效：v2')).toBeVisible()
  await expect(comparison).toContainText('已关闭')

  const protectedRule = addConstraint(instance.ctx, appId, 2, '志愿者只能签到', {
    kind: 'allowedWrites',
    viewId: 'desk',
    fields: ['checkedIn'],
  })
  // Save a deliberately conflicting pending proposal before the rule is checked at approval.
  // Using a different scripted planner verifies the normal invalid-proposal repair entry.
  const widened = {
    ...patch('扩大权限', 2),
    operations: [{ op: 'updateNode', nodeId: 'deskAction', params: { ask: ['name'] } }],
  }
  const invalid = await runPlan(
    instance.ctx,
    scripted([widened, widened, widened]),
    { intent: '让志愿者核对姓名', appId },
    () => {},
  )
  expect(invalid?.status).toBe('invalid')
  await page.goto(`${base}/apps/${appId}/studio`)
  await page.getByRole('button', { name: '分析冲突并建议局部修复' }).click()
  await expect(dialog).toContainText('不能直接改名')
  await dialog.getByRole('button', { name: '仅生成方案 A' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('已生效：v3')).toBeVisible()

  await page.locator('[data-node="rate"]').getByRole('button', { name: '查看计算依据' }).click()
  await expect(dialog).toContainText('0 ÷ 6 = 0.0%')
  await dialog.getByLabel('核对一条记录').fill('验收0')
  await dialog.getByText('验收0 · 不符合', { exact: true }).click()
  await expect(dialog).toContainText('已签到 等于 是')
  await page.screenshot({ path: info.outputPath('explanation.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '关闭' }).click()

  // Phase selection remains manual and receives normal review. Unrelated signup can close while desk rules stay active.
  const before = await (await request.get(`${base}/api/apps/${appId}/records`)).json()
  const side = page.getByRole('region', { name: '变更与版本' })
  await side.getByRole('tab', { name: '阶段', exact: true }).click()
  await side.getByLabel('阶段名称').fill('报名结束')
  await side.getByRole('checkbox', { name: /报名表 · 管理页 · 表单/ }).check()
  await side.getByRole('button', { name: '保存阶段配置' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(side.getByRole('heading', { name: '报名结束', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('phases.png'), animations: 'disabled' })
  await side.getByRole('button', { name: '预演切换' }).click()
  await expect(side.getByText('人工配置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('已生效：v4')).toBeVisible()
  expect(
    (
      await request.post(`${base}/api/apps/${appId}/records`, {
        data: { nodeId: 'signup', values: { name: '已停用', studentId: '999', major: '其他' } },
      })
    ).status(),
  ).toBe(403)
  expect(await (await request.get(`${base}/api/apps/${appId}/records`)).json()).toEqual(before)
  expect((await (await request.get(`${base}/api/apps/${appId}/constraints`)).json()).constraints[0].id).toBe(
    protectedRule.id,
  )
  expect(errors).toEqual([])
})
