import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3187',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: 'node e2e/serve.js',
    url: 'http://127.0.0.1:3187',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
