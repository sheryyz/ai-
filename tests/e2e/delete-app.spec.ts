import { expect, test } from './fixtures'

test('应用卡片删除：取消保留，失败可重试，确认后移除且刷新后仍不可访问', async ({ page, request }) => {
  const response = await request.post('/api/apps', {
    data: { templateId: 'event-registration', name: '删除验收应用', withSampleData: true },
  })
  expect(response.status()).toBe(201)
  const { app } = await response.json()
  await page.goto('/')
  const remove = page.getByRole('button', { name: '删除「删除验收应用」', exact: true })
  await remove.click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('36 条业务记录与版本历史会保留')
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).not.toBeVisible()
  expect((await request.get(`/api/apps/${app.id}`)).status()).toBe(200)

  await page.route(`**/api/apps/${app.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 500,
        json: { error: { code: 'TEST_FAILURE', message: '删除失败，请重试' } },
      })
    } else await route.continue()
  })
  await remove.click()
  await dialog.getByRole('button', { name: '删除应用', exact: true }).click()
  await expect(page.getByText('删除失败，请重试', { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  await page.unroute(`**/api/apps/${app.id}`)
  await dialog.getByRole('button', { name: '删除应用', exact: true }).click()
  await expect(remove).toHaveCount(0)
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '我的应用' })).toBeVisible()
  await expect(remove).toHaveCount(0)
  expect((await request.get(`/api/apps/${app.id}`)).status()).toBe(410)
})
