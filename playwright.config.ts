import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  // CI renders WebGL on the CPU (no GPU), so timed phases get one retry and more time
  retries: process.env.CI ? 1 : 0,
  timeout: process.env.CI ? 300_000 : 120_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    // Reuse a dev server that is already running (canvas inspector, local
    // CI rehearsal); on a CI runner nothing is listening, so a fresh one starts.
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] sets no channel, so Playwright launches the
        // bundled headless shell, which has no GPU backend and falls back to
        // SwiftShader (CPU) — roughly 4x slower raster and meaningless FPS.
        // The full Chromium build renders headless on the real GPU.
        channel: 'chromium',
        viewport: { width: 1280, height: 720 },
        // SOFTWARE_GL=1 rehearses CI locally: WebGL on SwiftShader like a GPU-less runner
        launchOptions: { args: process.env.SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] },
      },
    },
  ],
});
