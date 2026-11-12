/**
 * Both demo scenarios through the real UI, offline: recorded model responses are replayed through the
 * current validator (labelled 非实时生成), everything else — approval, records, restore — is live.
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

type AppBody = { app: { version: number; definition: { nodes: { id: string; type: string }[] } } }

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url)
  expect(res.ok(), `GET ${url}`).toBe(true)
  return (await res.json()) as T
}

const records = (request: APIRequestContext, appId: string) =>
  getJson<{ records: unknown[] }>(request, `/api/apps/${appId}/records`).then((b) => b.records)

/** A date N days ago in the business time zone (ADR-0005), as the date input expects. */
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

async function approveCreate(page: Page): Promise<string> {
  const approve = page.getByRole('button', { name: '批准并生效' })
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('非实时生成').first()).toBeVisible()
  await approve.click()
  await page.waitForURL(/\/apps\/[^/]+\/studio$/)
  return page.url().split('/apps/')[1]?.split('/')[0] ?? ''
}

test('场景 A：回放创建 → 录入 → 签到演进 → 拒绝删除 → 恢复旧版本后数据不变（AC-01/03/07/09）', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByText('离线模式 · 未配置模型')).toBeVisible()

  // Create from the recorded demo: pipeline → Morph Diff → approve.
  await page.getByRole('link', { name: /场景 A · 创建讲座报名系统/ }).click()
  await page.waitForURL(/\/studio\/new/)
  const appId = await approveCreate(page)
  expect(appId).not.toBe('')

  // Six registrations through the records API (the form itself is exercised in scenario B).
  const { app } = await getJson<AppBody>(request, `/api/apps/${appId}`)
  const form = app.definition.nodes.find((n) => n.type === 'Form')
  expect(form).toBeDefined()
  const people = [
    ['张三', '2024001', '计算机科学与技术', '13800000001'],
    ['李四', '2024002', '计算机科学与技术', '13800000002'],
    ['王五', '2024003', '电子信息工程', '13800000003'],
    ['赵六', '2024004', '计算机科学与技术', '13800000004'],
    ['孙七', '2024005', '工商管理', '13800000005'],
    ['周八', '2024006', '机械工程', '13800000006'],
  ]
  for (const [name, studentId, major, phone] of people) {
    const res = await request.post(`/api/apps/${appId}/records`, {
      data: { nodeId: form?.id, values: { name, studentId, major, phone } },
    })
    expect(res.status()).toBe(201)
  }
  await page.reload()
  await expect(page.getByText('6 条记录').first()).toBeVisible()

  // Evolve: check-in patch → ghost preview + Morph Diff naming the 6 existing records and their default.
  const approve = page.getByRole('button', { name: '批准并生效' })
  await page.getByRole('button', { name: /场景 A · 加签到、未签到提醒与签到率/ }).click()
  await expect(approve).toBeVisible({ timeout: 30_000 })
  const diff = page.getByRole('region', { name: '变更与版本' })
  await expect(diff).toContainText('默认')
  await expect(diff).toContainText('6')
  await approve.click()
  await expect(page.getByText('已生效：v2')).toBeVisible()

  // Use the new feature at once: check 张三 in; rate and reminder draft react.
  const preview = page.getByRole('region', { name: '预览' })
  const checkin = preview.locator('[data-node="quickCheckin"]')
  const rate = preview.locator('[data-node="metricCheckinRate"]')
  const draft = preview.locator('[data-node="draftReminder"]')
  await expect(checkin).toBeVisible()
  await expect(draft).toContainText('张三')
  await checkin.getByRole('textbox').fill('张三')
  await checkin.locator('li', { hasText: '张三' }).getByRole('button', { name: '标记已签到' }).click()
  await expect(rate).toContainText('16.7%')
  await expect(draft).not.toContainText('张三')

  // Forbidden intent: delete + reset is refused with a suggestion; nothing is touched.
  await page.getByRole('button', { name: /场景 A · 非法意图：删除未签到人员/ }).click()
  await expect(page.getByText('AI 拒绝了这个需求')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('建议改为：')).toBeVisible()
  // Retrying means a live model call, so offline the suggestion is shown without the retry button.
  await expect(page.getByRole('button', { name: '按建议重试' })).toHaveCount(0)
  const snapshot = JSON.stringify(await records(request, appId))
  expect(JSON.parse(snapshot)).toHaveLength(6)

  // AC-09: restore v1 → check-in UI gone, records identical; restore v2 → it comes back with 张三 checked in.
  await page.getByRole('tab', { name: /版本/ }).click()
  const restore = async (v: number) => {
    const row = page.locator('li', { hasText: new RegExp(`^v${v}`) }).filter({ hasText: '恢复此版本界面' })
    await row.first().getByRole('button', { name: '恢复此版本界面' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '恢复' }).click()
    await expect(page.getByText(`已恢复 v${v} 的界面`)).toBeVisible()
  }
  await restore(1)
  await expect(checkin).toHaveCount(0)
  expect(JSON.stringify(await records(request, appId))).toBe(snapshot)
  await restore(2)
  await expect(checkin).toBeVisible()
  await expect(rate).toContainText('16.7%')
  expect(JSON.stringify(await records(request, appId))).toBe(snapshot)

  expect(errors).toEqual([])
})

test('场景 B：同一引擎从零生成设备借用，表单登记、借出、归还，再演进标出超期（AC-04）', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('link', { name: /场景 B · 创建设备借用管理/ }).click()
  await page.waitForURL(/\/studio\/new/)
  const appId = await approveCreate(page)

  // Register three devices through the generated form.
  await page.goto(`/apps/${appId}`)
  for (const [name, code, category] of [
    ['单反相机', 'CAM-01', '相机'],
    ['投影仪 A', 'PRJ-01', '投影仪'],
    ['平板 1 号', 'PAD-01', '平板'],
  ] as const) {
    await page.getByLabel('设备名称').fill(name)
    await page.getByLabel('编号').fill(code)
    await page.getByLabel('类别').selectOption(category)
    await page.getByRole('button', { name: '保存设备' }).click()
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByLabel('设备名称')).toHaveValue('')
  }
  expect(await records(request, appId)).toHaveLength(3)

  // Lend two (one 10 days ago), return one.
  const lend = async (name: string, borrower: string, date: string) => {
    const row = page
      .locator('li', { hasText: name })
      .filter({ has: page.getByRole('button', { name: '确认借出' }) })
    await row.first().getByRole('button', { name: '确认借出' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('借用人').fill(borrower)
    await dialog.getByLabel('借用日期').fill(date)
    await dialog.getByRole('button', { name: '确认借出' }).click()
    await expect(dialog).toBeHidden()
  }
  await lend('单反相机', '王同学', daysAgo(10))
  await lend('投影仪 A', '李老师', daysAgo(2))
  const returning = page
    .locator('li', { hasText: '投影仪 A' })
    .filter({ has: page.getByRole('button', { name: '确认归还' }) })
  await returning.first().getByRole('button', { name: '确认归还' }).click()
  await expect(returning).toHaveCount(0)

  // Evolve with the recorded overdue patch, then the runtime lists only the device lent 10 days ago.
  await page.goto(`/apps/${appId}/studio`)
  await page.getByRole('button', { name: /场景 B · 标出借出超过 7 天的设备/ }).click()
  const approve = page.getByRole('button', { name: '批准并生效' })
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await approve.click()
  await expect(page.getByText('已生效：v2')).toBeVisible()

  await page.goto(`/apps/${appId}`)
  const overdue = page.locator('[data-node]', { hasText: '超期未还设备' }).last()
  await expect(overdue).toContainText('单反相机')
  await expect(overdue).not.toContainText('投影仪 A')
  await expect(overdue).not.toContainText('平板 1 号')
  expect(await records(request, appId)).toHaveLength(3)

  expect(errors).toEqual([])
})
