import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Cuentas y proyectos con API, SQLite temporal y web reales (sin mocks de la API).
// Cada ejecución usa una DB nueva (api-test-env.js); los correos son únicos por
// proyecto de navegador. Registros totales por ejecución ≤ 8, por debajo del
// límite de 10 por IP en 15 min de la API.

const SCREENSHOT_DIR = fileURLToPath(new URL('../../.local/screenshots/', import.meta.url));
const PASSWORD = 'una frase de paso bastante larga';
const UUID = /\/proyectos\/([0-9a-f-]{36})$/;

const emailFor = (testInfo, tag) =>
  `${tag}-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

async function tabTo(page, locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`No se alcanzó el elemento con Tab tras ${max} pulsaciones`);
}

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}

async function register(page, email) {
  await page.goto('/registro');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
}

async function login(page, email) {
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function createProject(page, { name, description = '', alternatives }) {
  await page.goto('/proyectos/nuevo');
  await page.getByLabel('Nombre').fill(name);
  if (description) await page.getByLabel(/Descripción/).fill(description);
  for (const alternative of alternatives) await page.getByRole('checkbox', { name: alternative }).check();
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page.getByText('Proyecto creado.')).toBeVisible();
  return page.url().match(UUID)[1];
}

const selection = (page) =>
  page.getByRole('region', { name: 'Alternativas seleccionadas' }).or(page.locator('.project-selection')).first();

test.describe('cuentas y proyectos (API real)', () => {
  test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));

  test('recorrido completo: acceso protegido, registro con teclado, crear, recargar, editar, borrar con cancelación, salir y entrar', async ({
    page,
  }, testInfo) => {
    const width = page.viewportSize().width;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const email = emailFor(testInfo, 'ana');

    // Catálogo público previo, sin sesión.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /alternativas autoalojables/i })).toBeVisible();
    await expect(page.locator('.site-header').getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('a[href^="/proyectos"]')).toHaveCount(0);

    // Acceso directo protegido: conserva el destino privado.
    await page.goto('/proyectos/nuevo');
    await expect(page).toHaveURL(/\/entrar\?siguiente=%2Fproyectos%2Fnuevo$/);
    await page.getByRole('main').getByRole('link', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/registro\?siguiente=%2Fproyectos%2Fnuevo$/);

    // Registro solo con teclado.
    await page.getByLabel('Correo').focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/proyectos\/nuevo$/);
    // Correo visible de la cuenta (la región de anuncios accesibles también lo menciona).
    await expect(page.locator('.site-header .account__email')).toHaveAttribute('title', email);

    // Crear: nombre/descr. con teclado y casillas con Espacio.
    await page.getByLabel('Nombre').fill('Nube familiar');
    await page.getByLabel(/Descripción/).fill('Fotos del móvil.\nDocumentos compartidos.');
    await tabTo(page, page.getByRole('checkbox', { name: 'Immich' }));
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('checkbox', { name: 'Nextcloud' }));
    await page.keyboard.press('Space');
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}identidad-formulario-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Crear proyecto' }).click();
    await expect(page.getByText('Proyecto creado.')).toBeVisible();
    await expect(page).toHaveURL(UUID);
    const id = page.url().match(UUID)[1];

    // Recarga: sesión y datos persisten.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Nube familiar' })).toBeVisible();
    await expect(selection(page).getByRole('listitem')).toHaveText(['Immich', 'Nextcloud']);

    // Editar nombre y selección (quitar Immich, añadir Outline).
    await page.getByRole('link', { name: 'Editar' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Nube familiar');
    await page.getByLabel('Nombre').fill('Nube familiar editada');
    await page.getByRole('button', { name: 'Quitar Immich' }).click();
    await page.getByRole('checkbox', { name: 'Outline' }).check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Nube familiar editada' })).toBeVisible();
    await expect(selection(page).getByRole('listitem')).toHaveText(['Nextcloud', 'Outline']);

    // Borrado: cancelar no cambia nada.
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('heading', { name: '¿Eliminar «Nube familiar editada»?' })).toBeFocused();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}identidad-confirmacion-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Eliminar' })).toBeFocused();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Nube familiar editada' })).toBeVisible();

    // Salir, acceso protegido de nuevo, entrar y conservar datos.
    await page.locator('.site-header').getByRole('button', { name: 'Salir' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/proyectos/${id}`);
    await expect(page).toHaveURL(new RegExp(`/entrar\\?siguiente=%2Fproyectos%2F${id}$`));
    await login(page, email);
    await expect(page).toHaveURL(new RegExp(`/proyectos/${id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Nube familiar editada' })).toBeVisible();

    // Confirmar borrado: vuelve a la lista y anuncia.
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Eliminar «Nube familiar editada»' }).click();
    await expect(page).toHaveURL(/\/proyectos$/);
    await expect(page.getByText('Proyecto eliminado.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aún no tienes proyectos' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}identidad-lista-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test('dos identidades: B no ve, lee, edita ni borra proyectos de A (UI y cliente HTTP)', async ({ page, browser, baseURL }, testInfo) => {
    await register(page, emailFor(testInfo, 'ana'));
    const idA = await createProject(page, { name: 'Privado de Ana', description: 'Solo Ana', alternatives: ['WireGuard'] });

    const contextB = await browser.newContext({ baseURL, viewport: page.viewportSize(), locale: 'es-ES' });
    const pageB = await contextB.newPage();
    try {
      await register(pageB, emailFor(testInfo, 'bea'));
      await expect(pageB.getByRole('heading', { name: 'Aún no tienes proyectos' })).toBeVisible();
      await expect(pageB.getByText('Privado de Ana')).toHaveCount(0);

      for (const path of [`/proyectos/${idA}`, `/proyectos/${idA}/editar`]) {
        await pageB.goto(path);
        await expect(pageB.getByRole('heading', { name: 'Proyecto no encontrado' })).toBeVisible();
        await expect(pageB.getByText('Privado de Ana')).toHaveCount(0);
      }

      // Cliente HTTP con la cookie de B: mismo 404 que un UUID inexistente.
      const http = pageB.request;
      const { csrfToken } = await (await http.get('/api/auth/session')).json();
      const write = { headers: { Origin: baseURL, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' } };
      const missing = randomUUID();
      for (const target of [idA, missing]) {
        const get = await http.get(`/api/projects/${target}`);
        const patch = await http.patch(`/api/projects/${target}`, { ...write, data: { name: 'Robado' } });
        const del = await http.delete(`/api/projects/${target}`, { ...write, data: {} });
        for (const res of [get, patch, del]) {
          expect(res.status()).toBe(404);
          expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'El proyecto no existe.' } });
          expect(res.headers()['cache-control']).toBe('no-store');
        }
      }
      expect(await (await http.get('/api/projects')).json()).toEqual({ projects: [] });

      // Sin CSRF u origen ajeno: 403; sin sesión: 401.
      const noToken = await http.patch(`/api/projects/${idA}`, { headers: { Origin: baseURL, 'Content-Type': 'application/json' }, data: { name: 'x' } });
      expect(noToken.status()).toBe(403);
      const foreign = await http.delete(`/api/projects/${idA}`, { ...write, headers: { ...write.headers, Origin: 'http://evil.example' }, data: {} });
      expect(foreign.status()).toBe(403);
    } finally {
      await contextB.close();
    }

    // A sigue intacto.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Privado de Ana' })).toBeVisible();
    await expect(page.getByText('Solo Ana')).toBeVisible();
  });

  test('sin sesión la API de proyectos responde 401', async ({ playwright, baseURL }) => {
    const http = await playwright.request.newContext({ baseURL });
    try {
      const res = await http.get('/api/projects');
      expect(res.status()).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    } finally {
      await http.dispose();
    }
  });

  test('errores al guardar (403, red, 401) conservan los valores y nunca reenvían solos', async ({ page, context }, testInfo) => {
    const email = emailFor(testInfo, 'carla');
    await register(page, email);
    await page.goto('/proyectos/nuevo');
    await page.getByLabel('Nombre').fill('Proyecto resistente');
    await page.getByLabel(/Descripción/).fill('No debe perderse');
    await page.getByRole('checkbox', { name: 'Matrix (Synapse)' }).check();
    const submit = page.getByRole('button', { name: 'Crear proyecto' });
    const expectValuesKept = async () => {
      await expect(page.getByLabel('Nombre')).toHaveValue('Proyecto resistente');
      await expect(page.getByLabel(/Descripción/)).toHaveValue('No debe perderse');
      await expect(page.getByRole('checkbox', { name: 'Matrix (Synapse)' })).toBeChecked();
    };
    let posts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects') posts += 1;
    });

    // 403 real de la API: token CSRF alterado en la petición.
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST'
        ? route.continue({ headers: { ...route.request().headers(), 'x-csrf-token': 'token-alterado' } })
        : route.continue(),
    );
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('No se ha guardado ningún cambio');
    await expectValuesKept();
    await page.unroute('**/api/projects');
    expect(posts).toBe(1);

    // Fallo de red.
    await page.route('**/api/projects', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('No se pudo conectar');
    await expectValuesKept();
    await page.unroute('**/api/projects');

    // Sesión perdida (cookie eliminada): 401 real → entrar y recuperar valores.
    await context.clearCookies();
    await submit.click();
    await expect(page).toHaveURL(/\/entrar\?siguiente=%2Fproyectos%2Fnuevo$/);
    await expect(page.getByRole('main').getByText(/tu sesión ha caducado/i)).toBeVisible();
    await login(page, email);
    await expect(page).toHaveURL(/\/proyectos\/nuevo$/);
    await expect(page.getByText(/hemos recuperado los datos/i)).toBeVisible();
    await expectValuesKept();
    const before = posts;
    await page.waitForTimeout(300);
    expect(posts).toBe(before); // nada se reenvió automáticamente

    await submit.click();
    await expect(page.getByText('Proyecto creado.')).toBeVisible();
    await page.goto('/proyectos');
    await expect(page.getByRole('link', { name: 'Proyecto resistente' })).toHaveCount(1);
  });
});
