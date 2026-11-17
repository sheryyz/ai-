// Real UI screenshots for the technical document, taken on an offline instance with an in-memory database.
//
//   PORT=8811 DATABASE_PATH=':memory:' LLM_API_KEY='' npm start      # another terminal
//   node docs/deliverables/tech-doc/capture.mjs http://localhost:8811
//
// It walks scenario A the way tests/e2e/mainline.spec.ts does: recorded deepseek-flash responses replayed
// through the current validator (the UI labels them 非实时生成); approvals, records and restores are live.
// The people are the same fictitious six as in the E2E tests.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:8811'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots')
mkdirSync(OUT, { recursive: true })
const H = { 'X-MorphOS-Request': '1' }

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  extraHTTPHeaders: H,
  reducedMotion: 'reduce',
})
const req = ctx.request
const status = await (await req.get(`${BASE}/api/auth/status`)).json()
const auth = await req.post(`${BASE}/api/auth/${status.setupRequired ? 'setup' : 'login'}`, {
  data: { username: 'demo-admin', password: 'MorphOS-doc-capture-2026' },
})
if (!auth.ok()) throw new Error(`auth ${auth.status()}`)

const page = await ctx.newPage()
const shot = async (name, target = page) => {
  await page.waitForTimeout(500)
  await target.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(name)
}
const approve = page.getByRole('button', { name: '批准并生效' })
const diff = page.getByRole('region', { name: '变更与版本' })
const preview = page.getByRole('region', { name: '预览' })
const chat = page.getByRole('region', { name: '对话' })

await page.goto(`${BASE}/`)
await page.getByText('离线模式').first().waitFor()
await shot('01-hub')

// 1 create
await page.getByRole('link', { name: /场景 A · 创建讲座报名系统/ }).click()
await approve.waitFor({ timeout: 30_000 })
const thinking = chat.getByText(/思考过程/).first()
if (await thinking.count()) await thinking.click()
await shot('02-create')
await approve.click()
await page.waitForURL(/\/apps\/[^/]+\/studio$/)
const appId = page.url().split('/apps/')[1].split('/')[0]

// 2 sign-up page
await page.getByRole('button', { name: /场景 A · 给报名的同学一个报名页/ }).click()
await approve.waitFor({ timeout: 30_000 })
await shot('03-signup')
await approve.click()
await page.getByText('已生效：v2').waitFor()

const { app } = await (await req.get(`${BASE}/api/apps/${appId}`)).json()
const form = app.definition.nodes.find((n) => n.type === 'Form' && !n.view)
for (const [name, studentId, major, phone] of [
  ['张三', '2024001', '计算机科学与技术', '13800000001'],
  ['李四', '2024002', '计算机科学与技术', '13800000002'],
  ['王五', '2024003', '电子信息工程', '13800000003'],
  ['赵六', '2024004', '计算机科学与技术', '13800000004'],
  ['孙七', '2024005', '工商管理', '13800000005'],
  ['周八', '2024006', '机械工程', '13800000006'],
]) {
  await req.post(`${BASE}/api/apps/${appId}/records`, {
    data: { nodeId: form.id, values: { name, studentId, major, phone } },
  })
}
await page.reload()
await page.getByText('6 条记录').first().waitFor()

// 3 evolve: check-in
await page.getByRole('button', { name: /场景 A · 加签到、未签到提醒与签到率/ }).click()
await approve.waitFor({ timeout: 30_000 })
await shot('04-evolve')
await shot('04-evolve-diff', diff)
await approve.click()
await page.getByText('已生效：v3').waitFor()
await preview.getByRole('tab', { name: '管理页' }).click()
const checkin = preview.locator('[data-node="quickCheckin"]')
await checkin.getByRole('textbox').fill('张三')
await checkin.locator('li', { hasText: '张三' }).getByRole('button', { name: '标记已签到' }).click()
await preview.locator('[data-node="metricCheckinRate"]').getByText('16.7%').waitFor()

// 4 desk with a restriction
await page.getByRole('button', { name: /场景 A · 门口志愿者的签到台/ }).click()
await approve.waitFor({ timeout: 30_000 })
await shot('05-desk')
await shot('05-desk-diff', diff)
await approve.click()
await page.getByText('已生效：v4').waitFor()

// 5 over the line: export needs an explicit confirmation
await page.getByRole('button', { name: /场景 A · 越界请求：让志愿者导出完整名单/ }).click()
await approve.waitFor({ timeout: 30_000 })
await page.getByText('确认向「签到台」的门口签到志愿者公开：学号').scrollIntoViewIfNeeded()
await shot('06-confirm-diff', diff)
await page.getByRole('button', { name: '拒绝' }).click()
await page.getByText('已拒绝，应用没有改动').waitFor()

// 6 forbidden intent
await page.getByRole('button', { name: /场景 A · 非法意图：删除未签到人员/ }).click()
await page.getByText('AI 拒绝了这个需求').waitFor({ timeout: 30_000 })
await page.waitForTimeout(400)
await shot('07-refusal', chat)
await shot('07-refusal-full')

// 7 structure, versions and share tabs
await page.getByRole('tab', { name: /结构/ }).click()
await shot('08-structure', diff)
await page.getByRole('tab', { name: /版本/ }).click()
await shot('09-versions', diff)
await page.getByRole('tab', { name: /分享/ }).click()
await page.waitForTimeout(800)
await shot('10-share-panel', diff)

// 8 admin runtime page
await page.goto(`${BASE}/apps/${appId}`)
await page.waitForTimeout(1200)
await shot('11-runtime')

// 9 phones: desk and sign-up page through their share links
const links = {}
for (const v of app.definition.views ?? []) {
  const r = await req.post(`${BASE}/api/apps/${appId}/views/${v.id}/link`)
  links[v.id] = (await r.json()).token ?? (await r.json()).link?.token
}
const { app: latest } = await (await req.get(`${BASE}/api/apps/${appId}`)).json()
const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN', deviceScaleFactor: 2 })
for (const v of latest.definition.views ?? []) {
  const r = await (await req.post(`${BASE}/api/apps/${appId}/views/${v.id}/link`)).json()
  const token = r.token ?? r.link?.token ?? r.view?.token
  if (!token) {
    console.log('no token for', v.id, JSON.stringify(r).slice(0, 200))
    continue
  }
  const p = await phone.newPage()
  await p.goto(`${BASE}/v/${token}`)
  await p.waitForTimeout(1500)
  await p.screenshot({ path: join(OUT, `12-share-${v.id}.png`) })
  console.log('12-share', v.id)
}

// 10 hub again with the app card
await page.goto(`${BASE}/`)
await page.waitForTimeout(800)
await shot('13-hub-apps')
await browser.close()
