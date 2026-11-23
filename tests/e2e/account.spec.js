import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// /cuenta con API, SQLite temporal y web reales. El entorno e2e no configura
// Google (sin credenciales reales): se verifica el estado "No disponible", la
// navegación, el destino protegido y que un motivo de callback se muestra y se
// limpia de la URL. El vínculo vivo con Google requiere credenciales reales.
// Una cuenta por proyecto de navegador (2 registros por ejecución).

const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));
const PASSWORD = 'una frase de paso bastante larga';

test.describe('mi cuenta (API real)', () => {
  test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));

  test('protegida, enlazada desde la cabecera y sin botón falso de Google', async ({ page }, testInfo) => {
    await page.goto('/cuenta');
    await expect(page).toHaveURL(/\/entrar\?siguiente=%2Fcuenta$/);

    const email = `cuenta-${testInfo.project.name}-${Date.now()}@example.com`;
    // El enlace alternativo de la página conserva ?siguiente=/cuenta.
    await page.locator('.auth-page__alternate').getByRole('link', { name: 'Crear cuenta' }).click();
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/cuenta$/);

    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
    await expect(page.getByText(email, { exact: true }).last()).toBeVisible();
    const section = page.getByRole('region', { name: 'Acceso con Google' });
    await expect(section.getByText('No disponible')).toBeVisible();
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.site-header').getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('aria-current', 'page');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}cuenta-${testInfo.project.name}.png`, fullPage: true });

    // Motivo fijo del callback: aviso visible y URL limpia; uno desconocido se ignora.
    await page.goto('/cuenta?reason=google_cancelled');
    await expect(page.getByText(/Cancelaste la vinculación en Google/)).toBeVisible();
    await expect(page).toHaveURL(/\/cuenta$/);
    await page.goto('/cuenta?reason=otra_cosa');
    await expect(page.getByRole('region', { name: 'Acceso con Google' })).toBeVisible();
    await expect(page.locator('.page-notice, .form-alert')).toHaveCount(0);
  });
});
