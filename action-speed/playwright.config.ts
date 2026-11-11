import { defineConfig, devices } from '@playwright/test';
if (process.env.FS_BASE && process.env.FS_BASE !== 'http://localhost:53927') throw new Error('This benchmark only targets the isolated local app.');
export default defineConfig({
  testDir: './tests', globalSetup:'./tests/setup.ts', testMatch: '**/*.spec.ts', timeout: 120_000, workers: 1, retries: 0, fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright.json' }]],
  use: { baseURL: 'http://localhost:53927', trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 8000 },
  projects: [
    {name:'desktop', use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
    {name:'mobile',use:{...devices['Pixel 7']}}
  ]
});
