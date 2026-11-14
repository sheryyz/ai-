import type { Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { createApp } from '../../apps/server/src/app'
import { parseConfig } from '../../apps/server/src/config'

const instance = createApp(parseConfig({ NODE_ENV: 'production', DATABASE_PATH: ':memory:' }))
let server: Server
let base = ''
test.beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing listener')
  base = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  instance.ctx.db.close()
})
test('首次设置、错误密码、重新登录、深链与退出保护；亮暗和手机布局', async ({ page, request }, info) => {
  await page.goto(base)
  await expect(page.getByRole('heading', { name: '开启你的工作区' })).toBeVisible()
  expect((await request.get(`${base}/api/apps`)).status()).toBe(401)
  await page.screenshot({ path: info.outputPath('setup-light.png'), animations: 'disabled' })
  await page.getByLabel('管理员账号', { exact: true }).fill('my-admin')
  await page.getByLabel('密码', { exact: true }).fill('my-long-password-2026')
  await page.getByLabel('确认密码', { exact: true }).fill('not-the-same-password')
  await page.getByRole('button', { name: '创建账号并进入' }).click()
  await expect(page.getByRole('alert')).toHaveText('两次输入的密码不一致')
  await page.getByLabel('确认密码', { exact: true }).fill('my-long-password-2026')
  await page.getByRole('button', { name: '创建账号并进入' }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  const response = await page.request.post(`${base}/api/apps`, { data: { templateId: 'event-registration' } })
  expect(response.status()).toBe(201)
  const { app } = await response.json()
  await page.goto(`${base}/apps/${app.id}`)
  await expect(page.getByRole('heading', { name: '校园讲座报名', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '欢迎回到 MorphOS' })).toBeVisible()
  expect((await page.request.get(`${base}/api/apps/${app.id}`)).status()).toBe(401)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: info.outputPath('login-mobile-dark.png'), animations: 'disabled' })
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  await page.getByLabel('管理员账号', { exact: true }).fill('my-admin')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password-2026')
  await page.getByRole('button', { name: '登录工作区' }).click()
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await page.getByLabel('密码', { exact: true }).fill('my-long-password-2026')
  await page.getByRole('button', { name: '登录工作区' }).click()
  await expect(page.getByRole('heading', { name: '校园讲座报名', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '校园讲座报名', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '工作区设置' }).click()
  await expect(page.getByRole('heading', { name: '工作区设置' })).toBeVisible()
  await page.screenshot({
    path: info.outputPath('settings-mobile-dark.png'),
    animations: 'disabled',
    fullPage: true,
  })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载数据库备份' }).click()
  const download = await downloadPromise
  const backupFile = await download.path()
  if (!backupFile) throw new Error('backup download missing')
  await page.request.post(`${base}/api/apps/${app.id}/records`, {
    data: { nodeId: 'signup', values: { name: '备份后新增', studentId: 'S1', major: '计算机' } },
  })
  await page.getByLabel('选择备份文件（本版本导出，最大 50 MB）').setInputFiles(backupFile)
  await page.getByRole('button', { name: '校验并创建恢复副本' }).click()
  await page.getByRole('button', { name: '确认创建副本' }).click()
  await expect(page.getByText('恢复副本已创建：1 个应用、0 条记录、1 个历史版本。')).toBeVisible()
  expect(instance.ctx.db.prepare('SELECT count(*) AS n FROM records').get()?.n).toBe(1)
  await page.getByLabel('当前密码', { exact: true }).fill('my-long-password-2026')
  await page.getByLabel('新密码', { exact: true }).fill('my-new-password-2026')
  await page.getByLabel('确认新密码', { exact: true }).fill('my-new-password-2026')
  await page.getByRole('button', { name: '修改密码并退出' }).click()
  await expect(page.getByRole('heading', { name: '欢迎回到 MorphOS' })).toBeVisible()
  await page.getByLabel('管理员账号', { exact: true }).fill('my-admin')
  await page.getByLabel('密码', { exact: true }).fill('my-new-password-2026')
  await page.getByRole('button', { name: '登录工作区' }).click()
  await expect(page.getByRole('heading', { name: '工作区设置' })).toBeVisible()
  // Another tab invalidating the session is enforced by the API; reload returns to login.
  await page.request.post(`${base}/api/auth/logout`)
  await page.reload()
  await expect(page.getByRole('heading', { name: '欢迎回到 MorphOS' })).toBeVisible()
})
