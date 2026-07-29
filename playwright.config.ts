import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './demo/tests/e2e',
  outputDir: './demo/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'demo/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  // Electron suites launch the production build directly. The web console
  // suite provides its own loopback server, so no global dev server is needed.
  projects: [{ name: 'electron', use: { ...devices['Desktop Chrome'] } }]
})
