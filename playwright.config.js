import { defineConfig, devices } from '@playwright/test';

const API_PORT = process.env.API_PORT || '3001';
const WEB_PORT = process.env.WEB_PORT || '5173';
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// Playwright arranca y detiene la API y la web reales. Los fallos (error,
// vacío, carga lenta) se simulan solo dentro de las pruebas con page.route.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: WEB_URL,
    locale: 'es-ES',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'escritorio-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'movil-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @nomoresaas/api start',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_HOST: '127.0.0.1', API_PORT },
    },
    {
      command: 'pnpm --filter @nomoresaas/web dev',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_HOST: '127.0.0.1', API_PORT, WEB_HOST: '127.0.0.1', WEB_PORT },
    },
  ],
});
