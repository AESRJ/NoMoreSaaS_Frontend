import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// 005 US2/SC-001: con el seed real, Google Drive → Nextcloud → comparativa en
// la misma página; /comparar antiguo vuelve al catálogo; movimiento reducido.
const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));

test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));

const circle = (page, name) => page.getByRole('button', { name: new RegExp(`^${name} \\d+ alternativas?$`) });

test('Google Drive → Nextcloud → comparativa sin salir de / y sin desbordamiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Encuentra una alternativa' }).fill('Google Drive');
  const drive = circle(page, 'Google Drive');
  await expect(drive).toHaveAttribute('aria-expanded', 'true');
  const tree = page.getByRole('region', { name: 'Alternativas a Google Drive' });
  const nextcloud = tree.getByRole('button', { name: 'Nextcloud' });
  await expect(nextcloud).toBeVisible();
  await nextcloud.click();
  const panel = page.getByRole('region', { name: 'Google Drive frente a Nextcloud' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Fuente oficial de Google Drive' })).toHaveAttribute(
    'href',
    'https://workspace.google.com/products/drive/',
  );
  await expect(panel.getByText(/desconocido: el catálogo no documenta sus capacidades/i)).toBeVisible();
  await expect(page).toHaveURL(/\/\?q=Google(\+|%20)Drive$/);
  const width = page.viewportSize().width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}explorador-${width}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('teclado: Tab llega al círculo, Enter abre el árbol y la alternativa abre la comparativa', async ({ page }) => {
  await page.goto('/');
  const slack = circle(page, 'Slack');
  await expect(slack).toBeVisible();
  await slack.focus();
  await page.keyboard.press('Enter');
  await expect(slack).toHaveAttribute('aria-expanded', 'true');
  await expect(slack).toBeFocused();
  const node = page.getByRole('region', { name: 'Alternativas a Slack' }).getByRole('button', { name: 'Matrix (Synapse)' });
  await node.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Slack frente a Matrix (Synapse)' })).toBeVisible();
  // El foco visible usa el color de acento.
  const outline = await node.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('/comparar antiguo redirige al catálogo con aviso y sin menú Comparar', async ({ page }) => {
  await page.goto('/comparar');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/la comparación ahora está dentro de cada servicio/i)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: /comparar/i })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: /selección para comparar/i })).toHaveCount(0);
  // La ficha sigue consultable por URL directa.
  await page.goto('/alternativas/nextcloud');
  await expect(page.getByRole('heading', { level: 1, name: 'Nextcloud' })).toBeVisible();
});

test.describe('movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('el árbol y la comparativa aparecen sin animación', async ({ page }) => {
    await page.goto('/');
    await circle(page, 'Notion').click();
    const tree = page.getByRole('region', { name: 'Alternativas a Notion' });
    await tree.getByRole('button', { name: 'Outline' }).click();
    const panel = page.getByRole('region', { name: 'Notion frente a Outline' });
    await expect(panel).toBeVisible();
    for (const locator of [tree, panel, tree.locator('.tree__branch').first()]) {
      expect(await locator.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    }
  });
});
