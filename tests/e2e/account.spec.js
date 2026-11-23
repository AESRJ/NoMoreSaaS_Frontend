import { expect, test } from '@playwright/test';

// /cuenta sin sesión con API y web reales. Las comprobaciones con sesión van al
// final del recorrido 1 de identity.spec.js para no registrar cuentas extra: la
// API limita a 10 registros por IP cada 15 min y la ejecución completa ya usa 10.

test('mi cuenta es privada: sin sesión redirige a /entrar conservando el destino', async ({ page }) => {
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/entrar\?siguiente=%2Fcuenta$/);
  await page.getByRole('main').getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/registro\?siguiente=%2Fcuenta$/);
  expect((await page.request.get('/api/account')).status()).toBe(401);
});
