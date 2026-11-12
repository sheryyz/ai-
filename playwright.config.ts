import { defineConfig, devices } from '@playwright/test'

const PORT = 8799

/**
 * End-to-end tests (tests/e2e) against the single-port production build.
 * The server runs offline (empty LLM_API_KEY) on an in-memory database, so every run starts clean,
 * needs no key and only uses the recorded demos — the same path a judge without a key would take.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm start',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: ':memory:',
      LLM_API_KEY: '',
      APP_TIMEZONE: 'Asia/Shanghai',
    },
  },
})
