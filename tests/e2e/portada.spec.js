import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Portada con la computadora generada en Higgsfield (job ade277e0-1c97-4ed2-
// 9256-26620b81639d, gpt_image_2_6) servida de verdad por la web y paleta
// exacta FR-009 calculada en el navegador.
const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));
const IMAGE = '/images/computadora-higgsfield.png';
const SHA256 = '6acf743b9e6bd95e06b45d06a2d37b45735b7d4feec26a024f1e8101b46012f4';

test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));

test('el PNG real se sirve con 200 y es el asset revisado', async ({ request }) => {
  const response = await request.get(IMAGE);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^image\/png/);
  const body = await response.body();
  expect(body.length).toBe(766682);
  expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(body.readUInt32BE(16)).toBe(1168);
  expect(body.readUInt32BE(20)).toBe(880);
  expect(createHash('sha256').update(body).digest('hex')).toBe(SHA256);
});

test('portada: computadora central renderizada, paleta exacta y sin desbordamiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const image = page.getByRole('img', { name: /computadora de escritorio negra/i });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth)).toBe(1168);
  expect(await image.evaluate((img) => img.naturalHeight)).toBe(880);
  // Sin selección no hay banda de comparación que tape el buscador.
  await expect(page.getByRole('complementary', { name: 'Selección para comparar' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: /buscar saas o alternativa/i })).toBeVisible();
  // Primera vista: cabecera arriba, computadora y título visibles.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.site-header')).toBeInViewport();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  const width = page.viewportSize().width;
  await page.screenshot({ path: `${SCREENSHOT_DIR}portada-${width}.png` });

  // Protagonista central: su centro horizontal coincide con el del viewport.
  const box = await image.boundingBox();
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(24);
  expect(box.width).toBeGreaterThan(Math.min(width - 64, 400));

  const colors = await page.evaluate(() => {
    const css = (selector, prop) => getComputedStyle(document.querySelector(selector))[prop];
    return {
      bg: css('body', 'backgroundColor') === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : css('body', 'backgroundColor'),
      h1: css('h1', 'color'),
      lead: css('.hero__lead', 'color'),
      panel: css('.search', 'backgroundColor'),
      text: css('.search__input', 'color'),
    };
  });
  expect(colors).toEqual({
    bg: 'rgb(0, 0, 0)',
    h1: 'rgb(255, 255, 255)',
    lead: 'rgb(189, 189, 189)',
    panel: 'rgb(17, 17, 17)',
    text: 'rgb(238, 238, 238)',
  });

  // CTA lima con texto negro.
  await expect(page.getByRole('searchbox', { name: /buscar saas o alternativa/i })).toBeVisible();
  await page.goto('/?q=inexistente');
  const reset = page.getByRole('button', { name: /restablecer búsqueda/i });
  expect(await reset.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual([
    'rgb(198, 253, 14)',
    'rgb(0, 0, 0)',
  ]);

  await page.goto('/');
  await expect(image).toBeVisible();

  // Selección pública: aparece con 2, conserva acciones y desaparece al limpiar.
  const bar = page.getByRole('complementary', { name: 'Selección para comparar' });
  await page.getByRole('button', { name: 'Añadir Nextcloud a la comparación' }).click();
  await page.getByRole('button', { name: 'Añadir Outline a la comparación' }).click();
  await expect(page.getByTestId('selection-count')).toHaveText('2 de 3');
  await expect(bar.getByRole('link', { name: /ver comparación/i })).toBeVisible();
  await bar.getByRole('button', { name: /limpiar selección/i }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('main')).toBeFocused();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});
