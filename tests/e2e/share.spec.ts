/**
 * Role views across two devices (AC-15 / 16 / 21 / 22): the organizer on a desktop, a participant or
 * volunteer on a phone-sized browser context. Offline: the share pages come from recorded model responses.
 */
import { type APIRequestContext, type Browser, devices, expect, type Page, test } from '@playwright/test'

type Plan = { type: string; proposal?: { id: string } }

/** Replays a recorded demo step through the planner API and approves it. */
async function replay(request: APIRequestContext, recordingId: string, appId?: string): Promise<string> {
  const res = await request.post('/api/ai/plan', { data: { recordingId, appId } })
  expect(res.ok()).toBe(true)
  const events = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Plan)
  const id = events.find((e) => e.type === 'result')?.proposal?.id
  expect(id, `${recordingId} produced a proposal`).toBeTruthy()
  const ok = await request.post(`/api/proposals/${id}/approve`, { data: {} })
  expect(ok.ok(), `approve ${recordingId}`).toBe(true)
  return ((await ok.json()) as { appId: string }).appId
}

function watchErrors(page: Page, allowed: RegExp[] = []): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !allowed.some((a) => a.test(m.text()))) errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

const phoneContext = (browser: Browser) => browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' })

test('分享页：志愿者在手机上签到，管理页几秒内同步；报名页提交新报名；恢复版本后链接停用（AC-15/16/21/22）', async ({
  page,
  request,
  browser,
}) => {
  // Organizer side, set up through the API: create → sign-up page → six people → check-in → desk.
  const appId = await replay(request, '01-event-create')
  await replay(request, '06-event-signup-page', appId)
  const app = (await (await request.get(`/api/apps/${appId}`)).json()) as {
    app: { definition: { nodes: { id: string; type: string; view?: string }[] } }
  }
  const form = app.app.definition.nodes.find((n) => n.type === 'Form' && !n.view)
  const people = [
    ['张三', '2024001', '计算机科学与技术', '13800000001'],
    ['李四', '2024002', '计算机科学与技术', '13800000002'],
    ['王五', '2024003', '电子信息工程', '13800000003'],
    ['赵六', '2024004', '计算机科学与技术', '13800000004'],
    ['孙七', '2024005', '工商管理', '13800000005'],
    ['周八', '2024006', '机械工程', '13800000006'],
  ]
  for (const [name, studentId, major, phone] of people) {
    const r = await request.post(`/api/apps/${appId}/records`, {
      data: { nodeId: form?.id, values: { name, studentId, major, phone } },
    })
    expect(r.status()).toBe(201)
  }
  await replay(request, '02-event-checkin', appId)
  await replay(request, '07-event-desk', appId)

  // Studio → 分享: create both links and take the "open here" address (works without a LAN).
  const adminErrors = watchErrors(page)
  await page.goto(`/apps/${appId}/studio`)
  await page.getByRole('tab', { name: '分享' }).click()
  const gen = page.getByRole('button', { name: '生成分享链接' })
  await expect(gen).toHaveCount(2)
  await gen.first().click()
  await expect(gen).toHaveCount(1)
  await gen.first().click()
  await expect(gen).toHaveCount(0)
  // View ids come from the recorded model output (07-event-desk, 06-event-signup-page).
  const openHere = (viewId: string) =>
    page.locator(`[data-view="${viewId}"]`).getByRole('link', { name: '在本机打开' }).getAttribute('href')
  const deskUrl = await openHere('checkinDesk')
  const signupUrl = await openHere('signupPage')
  expect(deskUrl).toMatch(/\/v\/[A-Za-z0-9_-]{24}$/)

  // The admin page, polled; nobody checked in yet.
  await page.goto(`/apps/${appId}`)
  const rate = page.locator('[data-node="metricCheckinRate"]')
  await expect(rate).toContainText('0 / 6')

  // Volunteer on a phone: names only, no phone numbers or student ids anywhere on the page.
  const phone = await phoneContext(browser)
  const desk = await phone.newPage()
  const deskErrors = watchErrors(desk, [/status of 410/])
  await desk.goto(deskUrl ?? '')
  await expect(desk.getByRole('heading', { name: '签到台' })).toBeVisible()
  const text = await desk.locator('body').innerText()
  // The desk lists a handful of people at a time (the search finds the rest).
  expect(people.some(([name]) => name && text.includes(name))).toBe(true)
  expect(text).not.toMatch(/1380000\d{4}/)
  expect(text).not.toMatch(/202400\d/)
  await expect(desk.getByText('MorphOS', { exact: true })).toHaveCount(0)

  await desk.getByRole('textbox').fill('李四')
  await desk.locator('li', { hasText: '李四' }).getByRole('button', { name: '标记已签到' }).click()
  await expect(desk.getByText(/签到登记完成/).first()).toBeVisible()
  // AC-22: the organizer sees it within a few seconds (records are polled every 3 s).
  await expect(rate).toContainText('1 / 6', { timeout: 5_000 })

  // Participant on a phone: the sign-up page only has the form.
  const signup = await phone.newPage()
  const signupErrors = watchErrors(signup)
  await signup.goto(signupUrl ?? '')
  await signup.getByLabel('姓名').fill('扫码同学')
  await signup.getByLabel('学号').fill('2024099')
  await signup.getByLabel('专业').selectOption('其他')
  await signup.getByLabel('手机号').fill('13800000099')
  await signup.getByRole('button', { name: '提交报名' }).click()
  await expect(signup.getByText(/报名成功/).first()).toBeVisible()
  await expect(page.getByText('7 条记录').first()).toBeVisible({ timeout: 5_000 })

  // AC-21: restoring the version before the desk switches its link off; records stay as they are.
  const before = await (await request.get(`/api/apps/${appId}/records`)).text()
  const restored = await request.post(`/api/apps/${appId}/versions/3/restore`, { data: { baseVersion: 4 } })
  expect(restored.ok()).toBe(true)
  await expect(desk.getByText('此页面已停用')).toBeVisible({ timeout: 8_000 })
  expect(await (await request.get(`/api/apps/${appId}/records`)).text()).toBe(before)

  expect([...adminErrors, ...deskErrors, ...signupErrors]).toEqual([])
  await phone.close()
})
