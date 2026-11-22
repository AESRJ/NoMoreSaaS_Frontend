import { expect, test } from '@playwright/test';

// Recorrido real del flujo (entrega 004, T005): API, SQLite temporal y web
// reales, sin mocks. Una sola cuenta por proyecto de navegador.
const PASSWORD = 'una frase de paso bastante larga';
const emailFor = (testInfo) => `flujo-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}

test('proyecto → equipo → evaluación → plan → avance persistente; 401 sin exponer estado privado', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/registro');
  await page.getByLabel('Correo').fill(emailFor(testInfo));
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);

  await page.goto('/proyectos/nuevo');
  await page.getByLabel('Nombre').fill('Casa autoalojada');
  await page.getByRole('checkbox', { name: 'Nextcloud' }).check();
  await page.getByRole('checkbox', { name: 'WireGuard' }).check();
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page.getByText('Proyecto creado.')).toBeVisible();

  await page.getByRole('link', { name: 'Equipo, evaluación y plan' }).click();
  await expect(page).toHaveURL(/\/proyectos\/[0-9a-f-]{36}\/flujo$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Equipo, evaluación y plan' })).toBeVisible();
  await expectNoPageOverflow(page);

  // Equipo: sin perfil guardado no hay evaluación.
  await page.getByRole('link', { name: 'Evaluación' }).click();
  await expect(page.getByRole('heading', { name: 'Aún no hay equipo guardado' })).toBeVisible();
  await page.getByRole('link', { name: 'Ir a Equipo' }).click();
  await page.getByLabel('Núcleos de CPU').fill('4');
  await page.getByLabel('RAM (GiB)').fill('8');
  await page.getByLabel('Espacio libre en disco (GiB)').fill('500');
  await page.getByLabel('Usuarios previstos').fill('3');
  await page.getByLabel('Datos previstos (GiB)').fill('100');
  await page.getByLabel('Sistema operativo del servidor').selectOption('linux');
  await page.getByLabel('Arquitectura de la CPU').selectOption('amd64');
  await page.getByLabel('Tipo de almacenamiento').selectOption('ssd');
  await page.getByRole('button', { name: 'Guardar equipo' }).click();
  await expect(page.getByText(/equipo guardado/i)).toBeVisible();

  // Evaluación real del servidor.
  await page.getByRole('link', { name: 'Evaluación' }).click();
  await expect(page.getByText('Cabe en el presupuesto orientativo')).toBeVisible();
  await expect(page.getByText(/RAM requerida = Σ RAM base \(2,25 GiB\)/)).toBeVisible();
  await expect(page.getByText(/ni garantiza que la instalación funcione/)).toBeVisible();
  await expectNoPageOverflow(page);

  // Plan: ocho pasos, prompt visible como texto.
  await page.getByRole('link', { name: 'Plan' }).click();
  await expect(page.getByText('0 de 8 pasos completados.')).toBeVisible();
  const first = page.getByRole('checkbox', { name: /Preparación Preparar el servidor para Nextcloud/ });
  // Sin marcado optimista: la casilla refleja el avance solo cuando el servidor lo confirma.
  await first.click();
  await expect(first).toBeChecked();
  await expect(page.getByText(/1 de 8 pasos completados/)).toBeVisible();
  await page.getByText('Ver prompt').first().click();
  await expect(page.locator('.prompt-box__text').first()).toContainText('Contexto: proyecto NoMoreSaaS «Casa autoalojada»');
  await expectNoPageOverflow(page);

  // Recarga: el avance viene del servidor.
  await page.reload();
  await expect(first).toBeChecked();
  await expect(page.getByText(/1 de 8 pasos completados/)).toBeVisible();

  // Sesión caducada: la escritura no se aplica y se pide entrar de nuevo.
  await page.context().clearCookies();
  await page.getByRole('checkbox', { name: /Instalación prevista Instalar Nextcloud/ }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText(/1 de 8 pasos completados/)).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Casa autoalojada');

  expect(errors).toEqual([]);
});
