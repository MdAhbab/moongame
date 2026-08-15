import { defineConfig, devices } from '@playwright/test'

/**
 * E2E configuration (gameplan §37.4).
 *
 * Runs against the *production* build rather than the dev server, because the
 * things most worth catching here — a chunk that fails to load, a CSP
 * violation, a minifier changing behaviour — only exist in the built output.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium falls back to SwiftShader without these, which
          // renders correctly but is far too slow to say anything useful about
          // frame time.
          args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    // `--host 127.0.0.1` is load-bearing, not decoration. Vite's default
    // preview host is `localhost`, which Node 17+ resolves per the system
    // order — on macOS that is `::1` first, so the server binds IPv6 loopback
    // *only*. The `url` below is IPv4 by necessity (Chromium and the health
    // check must agree on one origin), so the default binding leaves Playwright
    // polling an address nothing is listening on until the 120 s timeout, and
    // the suite fails before a single test runs. Pinning the family here keeps
    // the command and the URL talking about the same socket.
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
