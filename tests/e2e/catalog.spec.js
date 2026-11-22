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

const circle = (page, name) => page.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')} \\d+ alternativas?$`) });
const tree = (page, service) => page.getByRole('region', { name: `Alternativas a ${service}` });
const comparison = (page, service, alternative) => page.getByRole('region', { name: `${service} frente a ${alternative}` });

async function expectNoPageOverflow(page) {
  const report = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > viewport + 1)
      .filter((el) => getComputedStyle(el).position !== 'absolute')
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
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.services.length).toBe(5);
    expect(catalog.alternatives.map((a) => a.id).sort()).toEqual(['immich', 'matrix-synapse', 'nextcloud', 'outline', 'wireguard']);
    // 005: metadatos oficiales opcionales de Service.
    for (const service of catalog.services) {
      expect(service.officialUrl).toMatch(/^https:\/\//);
      expect(service.sources[0]).toMatchObject({ kind: 'official', url: expect.stringMatching(/^https:\/\//) });
    }
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

test.describe('US1–US2 con el seed real', () => {
  test('recorrido solo con teclado: búsqueda → círculo → alternativa → comparativa → ficha', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Encuentra una alternativa' });
    await tabTo(page, search);
    await page.keyboard.type('  SLACK ');
    await expect(page).toHaveURL(/q=/);
    const services = page.getByRole('region', { name: 'Servicios que coinciden' });
    await expect(services.getByRole('button', { name: /alternativas?$/ })).toHaveCount(1);
    // El único resultado se abre solo; el foco sigue en el buscador.
    await expect(circle(page, 'Slack')).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toBeFocused();

    const matrix = tree(page, 'Slack').getByRole('button', { name: 'Matrix (Synapse)' });
    await tabTo(page, matrix);
    await page.keyboard.press('Enter');
    const panel = comparison(page, 'Slack', 'Matrix (Synapse)');
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/\?q=/);
    await expect(panel.getByRole('link', { name: 'Fuente oficial de Slack' })).toHaveAttribute('href', 'https://slack.com/');

    await tabTo(page, panel.getByRole('link', { name: 'Ver ficha completa de Matrix (Synapse)' }), 80);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/alternativas\/matrix-synapse$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Matrix (Synapse)' })).toBeVisible();
    await expect(page.getByText(/última revisión de fuentes: 22 de noviembre de 2026/i)).toBeVisible();
  });

  test('buscar por alternativa muestra su servicio; Outline se identifica como código disponible', async ({ page }) => {
    await page.goto('/?q=outline');
    await expect(circle(page, 'Notion')).toHaveAttribute('aria-expanded', 'true');
    await tree(page, 'Notion').getByRole('button', { name: 'Outline' }).click();
    await expect(comparison(page, 'Notion', 'Outline').getByText(/código disponible \(no open source\)/i)).toBeVisible();
  });

  test('GitHub, Gitea y Forgejo ya no son opciones', async ({ page }) => {
    for (const term of ['github', 'gitea', 'forgejo']) {
      await page.goto(`/?q=${term}`);
      await expect(page.getByRole('heading', { name: /sin resultados/i })).toBeVisible();
    }
    await page.goto('/alternativas/gitea');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos esta alternativa/i })).toBeVisible();
  });

  test('cada servicio inicial abre su alternativa, comparativa y ficha sin iniciar sesión', async ({ page }) => {
    await page.goto('/');
    for (const [service, alternative] of [
      ['Google Drive', 'Nextcloud'],
      ['Google Fotos', 'Immich'],
      ['Slack', 'Matrix (Synapse)'],
      ['Tailscale', 'WireGuard'],
      ['Notion', 'Outline'],
    ]) {
      await circle(page, service).click();
      await tree(page, service).getByRole('button', { name: alternative }).click();
      const panel = comparison(page, service, alternative);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('link', { name: `Fuente oficial de ${service}` })).toHaveAttribute('href', /^https:\/\//);
    }
    await comparison(page, 'Notion', 'Outline').getByRole('link', { name: 'Ver ficha completa de Outline' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Outline' })).toBeVisible();
    await expect(page.getByRole('region', { name: /fuentes y fecha de revisión/i }).getByRole('listitem').first()).toBeVisible();
    await expect(page.locator('a[href^="/proyectos"]')).toHaveCount(0);
  });

  test('la página de servicio sigue consultable con su cobertura', async ({ page }) => {
    await page.goto('/saas/google-drive');
    await expect(page.getByRole('heading', { level: 1, name: 'Google Drive' })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Nextcloud', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nextcloud' })).toBeVisible();
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

  test('la comparación global se retiró: /comparar redirige y no queda menú ni botones de selección', async ({ page }) => {
    await page.goto('/comparar?ids=nextcloud,immich');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/la comparación ahora está dentro de cada servicio/i)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: /comparar/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /a la comparación/i })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('búsqueda sin resultados y restablecer', async ({ page }) => {
    await page.goto('/?q=inexistente');
    await expect(page.getByRole('heading', { name: /sin resultados/i })).toBeVisible();
    await page.getByRole('button', { name: /restablecer búsqueda/i }).click();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(page.getByRole('region', { name: 'Elige un servicio' }).getByRole('button', { name: /alternativas?$/ })).toHaveCount(5);
  });

  test('recursos inexistentes', async ({ page }) => {
    await page.goto('/alternativas/no-existe');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos esta alternativa/i })).toBeVisible();
    await page.goto('/saas/no-existe');
    await expect(page.getByRole('heading', { level: 1, name: /no encontramos este saas/i })).toBeVisible();
    await page.goto('/ruta/desconocida');
    await expect(page.getByRole('heading', { level: 1, name: /página no encontrada/i })).toBeVisible();
    await page.getByRole('link', { name: /volver al catálogo/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeVisible();
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
    await expect(page.getByRole('region', { name: 'Elige un servicio' })).toBeVisible();
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
  test('catálogo, comparativa y ficha sin desbordar; capturas', async ({ page }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const width = page.viewportSize().width;

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Elige un servicio' }).getByRole('button', { name: /alternativas?$/ })).toHaveCount(5);
    await expectNoPageOverflow(page);
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}catalogo-${width}.png`, fullPage: true });

    await circle(page, 'Tailscale').click();
    await tree(page, 'Tailscale').getByRole('button', { name: 'WireGuard' }).click();
    await expect(comparison(page, 'Tailscale', 'WireGuard')).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}comparativa-${width}.png`, fullPage: true });

    await page.goto('/alternativas/immich');
    await expect(page.getByRole('heading', { level: 1, name: 'Immich' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}ficha-${width}.png`, fullPage: true });
  });
});
