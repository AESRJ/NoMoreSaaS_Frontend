import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { alternative, catalogFixture } from './fixtures.js';
import { renderApp, resetSelection } from './helpers.jsx';

beforeEach(() => resetSelection());

function section(name) {
  return screen.getByRole('region', { name });
}

describe('US2: ficha de alternativa', () => {
  it('se abre desde el catálogo y muestra todos los campos con fuentes y fechas', async () => {
    const { user } = renderApp('/');
    const alternatives = await screen.findByRole('region', { name: /^alternativas/i });
    await user.click(within(alternatives).getByRole('link', { name: 'Archivero' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Archivero' })).toBeInTheDocument();
    expect(screen.getByText('Descripción de Archivero.')).toBeInTheDocument();
    expect(within(section(/capacidades/i)).getByText('Capacidad principal de Archivero')).toBeInTheDocument();
    expect(within(section(/limitaciones/i)).getByText('Limitación conocida de Archivero')).toBeInTheDocument();

    const license = section(/licencia/i);
    expect(within(license).getByRole('link', { name: /MIT/ })).toHaveAttribute('href', 'https://archivero.example.org/license');

    const difficulty = section(/dificultad/i);
    expect(within(difficulty).getByText('Intermedia')).toBeInTheDocument();
    expect(within(difficulty).getByText(/evaluación editorial/i)).toBeInTheDocument();
    expect(within(difficulty).getByText('Motivo editorial para Archivero.')).toBeInTheDocument();

    expect(within(section(/requisitos de autoalojamiento/i)).getByText('Requisitos documentados de Archivero.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sitio oficial/i })).toHaveAttribute('href', 'https://archivero.example.org/');
    expect(screen.getByRole('link', { name: /documentación oficial/i })).toHaveAttribute('href', 'https://archivero.example.org/docs');

    const sources = section(/fuentes/i);
    expect(within(sources).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sources).getByText(/fuente oficial/i)).toBeInTheDocument();
    expect(within(sources).getAllByText(/evaluación editorial/i).length).toBeGreaterThan(0);
    expect(within(sources).getByText('Evaluación editorial del equipo.')).toBeInTheDocument();
    expect(screen.getByText(/última revisión de fuentes: 20 de noviembre de 2026/i)).toBeInTheDocument();
  });

  it('funciona mediante enlace directo y muestra el SaaS que sustituye', async () => {
    renderApp('/alternativas/fotero');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fotero' })).toBeInTheDocument();
    const replaces = section(/sustituye a/i);
    expect(within(replaces).getByRole('link', { name: 'Fotos Nube' })).toHaveAttribute('href', '/saas/fotos');
    expect(within(replaces).getByText('Copia fotos desde el móvil.')).toBeInTheDocument();
  });

  it.each(['/alternativas/no-existe', '/alternativas/NO_VALIDO'])('%s muestra no encontrado con enlace al catálogo', async (path) => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: /no encontramos esta alternativa/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver al catálogo/i })).toHaveAttribute('href', '/');
  });

  it('una ruta desconocida muestra la página no encontrada', async () => {
    renderApp('/ruta/que/no/existe');
    expect(await screen.findByRole('heading', { level: 1, name: /página no encontrada/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver al catálogo/i })).toHaveAttribute('href', '/');
  });

  it('marca como no verificado lo que no tiene fuente y explica lo desconocido', async () => {
    const data = catalogFixture();
    const base = alternative('archivero', 'Archivero');
    data.alternatives[0] = {
      ...base,
      limitations: [],
      difficulty: { level: 'unknown', explanation: 'No se ha evaluado todavía.' },
      sources: [
        { ...base.sources[0], supports: ['name', 'description', 'capabilities', 'license', 'officialUrl', 'documentationUrl'] },
        { ...base.sources[1] },
      ],
    };
    renderApp('/alternativas/archivero', { data });
    await screen.findByRole('heading', { level: 1, name: 'Archivero' });
    expect(within(section(/limitaciones/i)).getByText(/no se documentaron limitaciones/i)).toBeInTheDocument();
    expect(within(section(/limitaciones/i)).getByText(/no verificado/i)).toBeInTheDocument();
    expect(within(section(/requisitos de autoalojamiento/i)).getByText(/no verificado/i)).toBeInTheDocument();
    expect(within(section(/dificultad/i)).getByText('Desconocida')).toBeInTheDocument();
    expect(within(section(/capacidades/i)).queryByText(/no verificado/i)).not.toBeInTheDocument();
  });

  it('distingue de forma visible una licencia source-available, también en la tarjeta del catálogo', async () => {
    const data = catalogFixture();
    data.alternatives[0] = {
      ...alternative('archivero', 'Archivero'),
      license: { label: 'BSL 1.1', url: 'https://archivero.example.org/license', classification: 'source-available' },
    };
    const { user } = renderApp('/', { data });
    const alternatives = await screen.findByRole('region', { name: /^alternativas/i });
    expect(within(alternatives).getByText('BSL 1.1 · Código disponible (no open source)')).toBeInTheDocument();
    await user.click(within(alternatives).getByRole('link', { name: 'Archivero' }));
    await screen.findByRole('heading', { level: 1, name: 'Archivero' });
    expect(within(section(/licencia/i)).getByText('Código disponible (no open source)')).toBeInTheDocument();
  });

  it('muestra el contenido del catálogo como texto, nunca como HTML', async () => {
    const data = catalogFixture();
    data.alternatives[0] = {
      ...alternative('archivero', 'Archivero'),
      description: '<img src=x onerror="window.__xss=1"><b>negrita</b>',
      capabilities: ['<script>window.__xss=2</script>'],
    };
    const { container } = renderApp('/alternativas/archivero', { data });
    await screen.findByRole('heading', { level: 1, name: 'Archivero' });
    expect(screen.getByText('<img src=x onerror="window.__xss=1"><b>negrita</b>')).toBeInTheDocument();
    expect(container.querySelector('main img')).toBeNull();
    expect(container.querySelector('main b')).toBeNull();
    expect(container.querySelector('main script')).toBeNull();
    expect(window.__xss).toBeUndefined();
  });

  it('no genera enlaces con esquemas no HTTP(S)', async () => {
    const data = catalogFixture();
    data.alternatives[0] = { ...alternative('archivero', 'Archivero'), officialUrl: 'javascript:alert(1)' };
    const { container } = renderApp('/alternativas/archivero', { data });
    await screen.findByRole('heading', { level: 1, name: 'Archivero' });
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByText(/sitio oficial: enlace no disponible/i)).toBeInTheDocument();
  });
});
