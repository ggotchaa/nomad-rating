import { defineConfig, devices } from '@playwright/test'

const API_PORT = 3030
const WEB_PORT = 5190
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://nomad:nomad@127.0.0.1:5433/nomad_e2e'

export default defineConfig({
  testDir: './tests',
  outputDir: './.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './.report' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    // The site defaults to Kazakh; the specs use Russian texts.
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${WEB_PORT}`, localStorage: [{ name: 'nomad.locale', value: 'ru' }] }] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /\.mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      // Rebuilds the e2e database (migrations + demo data), then starts the API.
      command: 'npm run demo:reset && npm start -w @nomad/server',
      cwd: '..',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 300_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
      env: { DATABASE_URL, DEMO_MODE: 'true', REDIS_URL: '', PORT: String(API_PORT), HOST: '127.0.0.1', NODE_ENV: 'development', SITE_URL: `http://127.0.0.1:${WEB_PORT}` },
    },
    {
      command: `npm run dev -w @nomad/web -- --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
      env: { API_ORIGIN: `http://127.0.0.1:${API_PORT}` },
    },
  ],
})
