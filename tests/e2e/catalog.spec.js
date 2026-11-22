import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));

/** Pulsa Tab hasta que el localizador tenga el foco (navegación solo con teclado). */
async function tabTo(page, locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`No se alcanzó el elemento con Tab tras ${max} pulsaciones`);
}

async function addToComparison(page, name) {
  await page.getByRole('button', { name: `Añadir ${name} a la comparación` }).click();
  await expect(page.getByRole('button', { name: `Quitar ${name} de la comparación` })).toHaveAttribute('aria-pressed', 'true');
}

async function expectNoPageOverflow(page) {
  const report = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > viewport + 1)
      .filter((el) => !el.closest('.table-scroll') || el.classList.contains('table-scroll') || getComputedStyle(el).position === 'absolute')
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return { overflow: document.documentElement.scrollWidth - viewport, offenders };
  });
  expect(report, `Elementos fuera del viewport: ${report.offenders.join('; ')}`).toMatchObject({ overflow: 0 });
}

test.describe('API real a través del proxy', () => {
  test('salud, catálogo y errores del contrato', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const catalog = await (await request.get('/api/catalog')).json();
    expect(catalog.services.length).toBe(5);
    expect(catalog.alternatives.map((a) => a.id).sort()).toEqual(['immich', 'matrix-synapse', 'nextcloud', 'outline', 'wireguard']);
    const retired = await request.get('/api/alternatives/gitea');
    expect(retired.status()).toBe(404);

    const invalid = await request.get('/api/alternatives/NO_VALIDO');
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe('INVALID_ID');
    const missing = await request.get('/api/alternatives/no-existe');
    expect(missing.status()).toBe(404);
    const write = await request.post('/api/catalog', { data: {} });
    expect(write.status()).toBe(404);
  });
});

test.describe('US1–US3 con el seed real', () => {
  test('recorrido solo con teclado: búsqueda → ficha → selección → comparación', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /alternativas autoalojables/i })).toBeVisible();

    const search = page.getByRole('searchbox', { name: /buscar saas o alternativa/i });
    await tabTo(page, search);
    await page.keyboard.type('  SLACK ');
    await expect(page).toHaveURL(/q=/);
    const services = page.getByRole('region', { name: /servicios saas que coinciden/i });
    await expect(services.getByRole('heading', { name: 'Slack' })).toBeVisible();
    await expect(page.getByRole('region', { name: /servicios saas/i }).getByRole('heading', { name: 'Google Drive' })).toHaveCount(0);

    await tabTo(page, services.getByRole('link', { name: 'Matrix (Synapse)' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/alternativas\/matrix-synapse$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Matrix (Synapse)' })).toBeVisible();
    await expect(page.getByText(/última revisión de fuentes: 22 de noviembre de 2026/i)).toBeVisible();

    const addMatrix = page.getByRole('button', { name: 'Añadir Matrix (Synapse) a la comparación' });
    await tabTo(page, addMatrix);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Quitar Matrix (Synapse) de la comparación' })).toHaveAttribute('aria-pressed', 'true');

    await tabTo(page, page.getByRole('link', { name: /volver al catálogo/i }), 80);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
    await tabTo(page, page.getByRole('searchbox'));
    await page.keyboard.type('outline');
    const addOutline = page.getByRole('button', { name: 'Añadir Outline a la comparación' });
    await tabTo(page, addOutline);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('selection-count')).toHaveText('2 de 3');

    await tabTo(page, page.getByRole('link', { name: /ver comparación/i }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/comparar$/);
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: /matrix/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /outline/i })).toBeVisible();
    await expect(table.getByText(/código disponible \(no open source\)/i)).toBeVisible();
    await expect(page.getByText(/cubren necesidades distintas/i)).toBeVisible();
  });

  test('GitHub, Gitea y Forgejo ya no son opciones', async ({ page }) => {
    for (const term of ['github', 'gitea', 'forgejo']) {
      await page.goto(`/?q=${term}`);
      await expect(page.getByRole('heading', { name: /sin resultados/i })).toBeVisible();
    }
    await page.goto('/alternativas/gitea');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos esta alternativa/i })).toBeVisible();
  });

  test('cada SaaS inicial lleva a una ficha sin iniciar sesión', async ({ page }) => {
    for (const [service, alternative] of [
      ['Google Drive', 'Nextcloud'],
      ['Google Fotos', 'Immich'],
      ['Slack', 'Matrix (Synapse)'],
      ['Tailscale', 'WireGuard'],
      ['Notion', 'Outline'],
    ]) {
      await page.goto('/');
      await page.getByRole('region', { name: /^servicios saas$/i }).getByRole('link', { name: service, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: service })).toBeVisible();
      await page.getByRole('main').getByRole('link', { name: alternative, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: alternative })).toBeVisible();
      await expect(page.getByRole('region', { name: /fuentes y fecha de revisión/i }).getByRole('listitem').first()).toBeVisible();
    }
  });

  test('enlace directo y recarga de ficha conservan el contenido', async ({ page }) => {
    await page.goto('/alternativas/nextcloud');
    await expect(page.getByRole('heading', { level: 1, name: 'Nextcloud' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Nextcloud' })).toBeVisible();
    const license = page.getByRole('region', { name: 'Licencia' });
    await expect(license.getByRole('link', { name: 'GNU AGPL v3' })).toHaveAttribute('href', 'https://github.com/nextcloud/server/blob/master/COPYING');
    await expect(page.getByRole('region', { name: /dificultad/i }).getByText(/evaluación editorial de nomoresaas/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /documentación oficial de nextcloud/i })).toHaveAttribute('rel', /noopener/);
  });

  test('la selección se mantiene al navegar y se pierde al recargar /comparar', async ({ page }) => {
    await page.goto('/');
    await addToComparison(page, 'Nextcloud');
    await addToComparison(page, 'Immich');
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: /comparar/i }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText(/cubren necesidades distintas/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/faltan 2/i)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('límite de tres, quitar y limpiar', async ({ page }) => {
    await page.goto('/');
    await addToComparison(page, 'WireGuard');
    await addToComparison(page, 'Outline');
    await addToComparison(page, 'Immich');
    await page.getByRole('button', { name: 'Añadir Nextcloud a la comparación' }).click();
    await expect(page.getByRole('alert')).toContainText(/máximo de 3/i);
    await expect(page.getByTestId('selection-count')).toHaveText('3 de 3');
    await page.getByRole('link', { name: /ver comparación/i }).click();
    await page.getByRole('table').getByRole('button', { name: 'Quitar Immich de la comparación' }).click();
    await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(3);
    await page.getByRole('button', { name: /limpiar selección/i }).click();
    await expect(page.getByText(/faltan 2/i)).toBeVisible();
  });

  test('búsqueda sin resultados y restablecer', async ({ page }) => {
    await page.goto('/?q=inexistente');
    await expect(page.getByRole('heading', { name: /sin resultados/i })).toBeVisible();
    await page.getByRole('button', { name: /restablecer búsqueda/i }).click();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(page.getByRole('region', { name: /^alternativas$/i }).getByRole('article')).toHaveCount(5);
  });

  test('recursos inexistentes', async ({ page }) => {
    await page.goto('/alternativas/no-existe');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos esta alternativa/i })).toBeVisible();
    await page.goto('/saas/no-existe');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos este saas/i })).toBeVisible();
    await page.goto('/ruta/desconocida');
    await expect(page.getByRole('heading', { level: 1, name: /página no encontrada/i })).toBeVisible();
    await page.getByRole('link', { name: /volver al catálogo/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /alternativas autoalojables/i })).toBeVisible();
  });
});

test.describe('estados simulados solo en la prueba (sin tocar el seed)', () => {
  test('carga y error con reintento', async ({ page }) => {
    let fail = true;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/catalog', async (route) => {
      await gate;
      if (fail) {
        fail = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}' });
        return;
      }
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: /cargando el catálogo/i })).toBeVisible();
    release();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/no se pudo cargar el catálogo/i);
    await expect(page.getByText(/todavía no tiene alternativas/i)).toHaveCount(0);
    await alert.getByRole('button', { name: /reintentar/i }).click();
    await expect(page.getByRole('region', { name: /^servicios saas$/i })).toBeVisible();
  });

  test('catálogo vacío', async ({ page }) => {
    await page.route('**/api/catalog', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, services: [], alternatives: [], relations: [] }) }),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /todavía no tiene alternativas/i })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('presentación responsive y capturas', () => {
  test('catálogo, ficha y comparación sin perder controles; capturas', async ({ page }, testInfo) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const width = page.viewportSize().width;

    await page.goto('/');
    await expect(page.getByRole('region', { name: /^alternativas$/i }).getByRole('article')).toHaveCount(5);
    await expectNoPageOverflow(page);
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}catalogo-${width}.png`, fullPage: true });

    await page.goto('/alternativas/immich');
    await expect(page.getByRole('heading', { level: 1, name: 'Immich' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}ficha-${width}.png`, fullPage: true });

    await page.getByRole('link', { name: /volver al catálogo/i }).click();
    await addToComparison(page, 'Matrix (Synapse)');
    await addToComparison(page, 'Outline');
    await addToComparison(page, 'Nextcloud');
    await page.getByRole('link', { name: /ver comparación/i }).click();
    const region = page.getByRole('region', { name: /tabla de comparación/i });
    await expect(region).toBeVisible();
    await expectNoPageOverflow(page);
    for (const name of ['Matrix (Synapse)', 'Outline', 'Nextcloud']) {
      const button = page.getByRole('button', { name: `Quitar ${name} de la comparación` });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
    }
    if (testInfo.project.name === 'movil-360') {
      const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrollable).toBe(true);
      await expect(page.getByText(/desliza horizontalmente/i)).toBeVisible();
    }
    await region.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SCREENSHOT_DIR}comparacion-${width}.png`, fullPage: true });
  });
});
