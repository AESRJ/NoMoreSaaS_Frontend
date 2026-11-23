import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// «Continuar con Google» con API y web reales. El entorno e2e no configura
// Google: el estado real es «no disponible». El botón y la salida a Google se
// verifican con respuestas fixture interceptadas en el navegador (page.route);
// ninguna petición llega a Google. Esto NO es una prueba viva con Google.

const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));
const FIXTURE_GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=fixture';

test.describe('acceso con Google', () => {
  test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));

  test('sin configuración real: sin botón falso, aviso y callback real con motivo fijo', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByText(/El acceso con Google no está disponible en este servidor/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

    // El callback real de la API sin configuración redirige con un motivo fijo.
    await page.goto('/api/auth/google/callback?state=x&code=y');
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('alert')).toContainText('No se pudo completar el acceso con Google');
  });

  test('con proveedor fixture: botón, navegación completa a Google y avisos de vuelta', async ({ page }, testInfo) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: { enabled: true } } }));
    let startBody = null;
    await page.route('**/api/auth/google/start', (route) => {
      startBody = route.request().postDataJSON();
      route.fulfill({ json: { authorizationUrl: FIXTURE_GOOGLE_URL } });
    });
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Google (fixture)</title><p>fixture</p>' }),
    );

    await page.goto('/entrar?reason=google_cancelled');
    await expect(page.getByText(/Cancelaste el acceso con Google/)).toBeVisible();
    await expect(page).toHaveURL(/\/entrar$/);
    const button = page.getByRole('button', { name: 'Continuar con Google' });
    await expect(button).toBeVisible();
    await expect(page.getByLabel('Correo')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}google-entrar-${testInfo.project.name}.png`, fullPage: true });

    await page.goto('/registro');
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    await page.goto('/entrar');
    await button.click();
    await expect(page).toHaveURL(FIXTURE_GOOGLE_URL);
    expect(startBody).toEqual({});
  });
});
