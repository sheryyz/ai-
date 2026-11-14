import { test as base, expect } from '@playwright/test'

export type { APIRequestContext, Browser, Page } from '@playwright/test'
export { devices } from '@playwright/test'
export { expect }
export const test = base.extend<{ authBaseURL: { url: () => string } | null; signedIn: undefined }>({
  authBaseURL: [null, { option: true }],
  signedIn: [
    async ({ request, context, baseURL, authBaseURL }, use) => {
      const url = authBaseURL?.url() ?? baseURL
      const status = await (await request.get(`${url}/api/auth/status`)).json()
      const response = await request.post(`${url}/api/auth/${status.setupRequired ? 'setup' : 'login'}`, {
        data: { username: 'e2e-admin', password: 'MorphOS-test-password-2026' },
      })
      expect(response.ok()).toBeTruthy()
      await context.addCookies((await request.storageState()).cookies)
      await use(undefined)
    },
    { auto: true },
  ],
})
