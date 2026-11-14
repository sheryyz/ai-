import { type APIRequestContext, expect, test } from './fixtures'

async function replay(request: APIRequestContext, recordingId: string, appId?: string) {
  const response = await request.post('/api/ai/plan', { data: { recordingId, appId } })
  expect(response.ok()).toBe(true)
  const result = (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((e) => e.type === 'result')
  expect(result.outcome).toBe('pending')
  const approved = await request.post(`/api/proposals/${result.proposal.id}/approve`)
  expect(approved.ok()).toBe(true)
  return (await approved.json()).appId as string
}

test('真实记录预演、建议草稿保护、数据流图和持续规则的确认/恢复拦截/解除', async ({
  page,
  request,
}, testInfo) => {
  const appId = await replay(request, '01-event-create')
  await replay(request, '06-event-signup-page', appId)
  const app = (await (await request.get(`/api/apps/${appId}`)).json()).app
  const form = app.definition.nodes.find((n: { type: string; view?: string }) => n.type === 'Form' && !n.view)
  for (let i = 0; i < 6; i++) {
    expect(
      (
        await request.post(`/api/apps/${appId}/records`, {
          data: {
            nodeId: form.id,
            values: {
              name: `同学${i}`,
              studentId: `202600${i}`,
              major: i < 3 ? '计算机科学与技术' : '电子信息工程',
              phone: `1380000000${i}`,
            },
          },
        })
      ).status(),
    ).toBe(201)
  }
  // Only the health response is mocked to enable drafting; no live model call is made.
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch()
    const health = await response.json()
    await route.fulfill({ json: { ...health, ai: { ...health.ai, configured: true } } })
  })
  await page.goto(`/apps/${appId}/studio`)
  await page.getByRole('button', { name: /场景 A · 加签到、未签到提醒与签到率/ }).click()
  const impact = page.getByRole('region', { name: '业务影响预演' })
  await expect(impact).toContainText('当前 6 条记录')
  await expect(impact).toContainText('提醒对象：0 → 3 条')
  await impact.getByText('进入 3 条 · 查看对象', { exact: true }).click()
  await expect(impact).toContainText('同学0')
  await page.screenshot({ path: testInfo.outputPath('business-impact.png') })
  // A signup races with approval. Keep the browser's old preview until the server rejects it.
  const proposals = (await (await request.get(`/api/apps/${appId}/proposals`)).json()).proposals
  const pendingId = proposals.find((p: { status: string }) => p.status === 'pending').id
  const previewUrl = `/api/proposals/${pendingId}/preview`
  const oldPreview = await (await request.get(previewUrl)).json()
  await page.route(`**${previewUrl}`, (route) => route.fulfill({ json: oldPreview }))
  expect(
    (
      await request.post(`/api/apps/${appId}/records`, {
        data: {
          nodeId: form.id,
          values: { name: '新报名', studentId: '2026999', major: '电子信息工程', phone: '13800000999' },
        },
      })
    ).status(),
  ).toBe(201)
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('数据已变化，请查看最新业务影响预演后重新批准', { exact: true })).toBeVisible()
  await page.unroute(`**${previewUrl}`)
  await expect(impact).toContainText('当前 7 条记录')
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('已生效：v3')).toBeVisible()

  const composer = page.getByRole('textbox', { name: '描述你的需求' })
  await composer.fill('请保留我的未发送需求')
  await page.getByRole('button', { name: '填入输入框' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('替换当前输入')
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(composer).toHaveValue('请保留我的未发送需求')
  await page.getByRole('button', { name: '填入输入框' }).click()
  await dialog.getByRole('button', { name: '替换为建议' }).click()
  await expect(composer).toHaveValue(/完整输入范围和上游筛选/)
  await expect(page.getByRole('button', { name: '批准并生效' })).toHaveCount(0)

  await page.getByRole('button', { name: /场景 A · 门口志愿者的签到台/ }).click()
  await page.getByRole('button', { name: '批准并生效' }).click()
  await expect(page.getByText('已生效：v4')).toBeVisible()
  const recordsBefore = await (await request.get(`/api/apps/${appId}/records`)).json()
  const side = page.getByRole('region', { name: '变更与版本' })
  await side.getByRole('tab', { name: '结构', exact: true }).click()
  await expect(page.getByRole('img', { name: /数据流图/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('data-flow.png') })
  await side.getByRole('tab', { name: '约束', exact: true }).click()
  const candidate = side.getByText(/^签到台只能修改/).locator('..')
  await candidate.getByRole('button', { name: '确认为长期规则' }).click()
  await dialog.getByRole('button', { name: '确认规则', exact: true }).click()
  await expect(side.getByText('已确认的规则 · 1')).toBeVisible()
  await page.reload()
  await side.getByRole('tab', { name: '约束', exact: true }).click()
  await expect(side.getByText('已确认的规则 · 1')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('constraints.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: testInfo.outputPath('constraints-dark.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await side.getByRole('tab', { name: '约束', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true)
  await side.screenshot({ path: testInfo.outputPath('constraints-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await side.getByRole('tab', { name: '版本', exact: true }).click()
  await side.getByRole('button', { name: '恢复此版本界面' }).last().click()
  const restore = page.getByRole('dialog')
  await expect(restore).toContainText('受保护的角色页面必须保留且可用')
  await expect(restore.getByRole('button', { name: '恢复', exact: true })).toBeDisabled()
  await restore.getByRole('button', { name: '取消' }).click()
  await side.getByRole('tab', { name: '约束', exact: true }).click()
  await side.getByRole('button', { name: '解除规则' }).click()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(side.getByText('已确认的规则 · 1')).toBeVisible()
  await side.getByRole('button', { name: '解除规则' }).click()
  await dialog.getByRole('button', { name: '解除规则', exact: true }).click()
  await expect(side.getByText('已确认的规则 · 0')).toBeVisible()
  await side.getByRole('tab', { name: '版本', exact: true }).click()
  await side.getByRole('button', { name: '恢复此版本界面' }).last().click()
  await restore.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(restore).toBeHidden()
  expect(await (await request.get(`/api/apps/${appId}/records`)).json()).toEqual(recordsBefore)
})
