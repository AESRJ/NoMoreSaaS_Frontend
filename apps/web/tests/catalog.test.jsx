import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogLoadError } from '../src/api/catalog.js';
import { catalogFixture, emptyCatalog } from './fixtures.js';
import { renderApp, resetSelection } from './helpers.jsx';

beforeEach(() => resetSelection());

const servicesSection = () => screen.getByRole('region', { name: /servicios saas/i });
const alternativesSection = () => screen.getByRole('region', { name: /^alternativas/i });

describe('US1: catálogo público', () => {
  it('muestra carga y después los SaaS y alternativas sin pedir cuenta', async () => {
    renderApp('/');
    expect(screen.getByText(/cargando el catálogo/i).closest('[role="status"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeInTheDocument();
    const services = servicesSection();
    for (const name of ['Drive Nube', 'Fotos Nube', 'Forja Nube']) {
      expect(within(services).getByRole('link', { name })).toBeInTheDocument();
    }
    const alternatives = alternativesSection();
    for (const name of ['Archivero', 'Fotero', 'Gitero', 'GitLibre']) {
      expect(within(alternatives).getByRole('link', { name })).toBeInTheDocument();
    }
    // Desde 003 la cabecera ofrece Entrar/Crear cuenta (contracts/ui.md); el
    // catálogo en sí sigue sin pedir cuenta.
    expect(within(screen.getByRole('main')).queryByText(/iniciar sesión|registrarse|crear cuenta/i)).not.toBeInTheDocument();
  });

  it('cada SaaS enlaza a sus alternativas relacionadas', async () => {
    renderApp('/');
    const card = (await screen.findByRole('heading', { name: 'Forja Nube' })).closest('article');
    expect(within(card).getByRole('link', { name: 'Gitero' })).toHaveAttribute('href', '/alternativas/gitero');
    expect(within(card).getByRole('link', { name: 'GitLibre' })).toHaveAttribute('href', '/alternativas/gitlibre');
  });

  it('busca un SaaS ignorando mayúsculas y espacios y refleja q en la URL', async () => {
    const { user, fetcher } = renderApp('/');
    const input = await screen.findByRole('searchbox', { name: 'Encuentra una alternativa' });
    await user.type(input, '  forja NUBE ');
    const services = servicesSection();
    expect(within(services).getByRole('heading', { name: 'Forja Nube' })).toBeInTheDocument();
    expect(within(services).queryByRole('heading', { name: 'Drive Nube' })).not.toBeInTheDocument();
    expect(within(services).getByRole('link', { name: 'Gitero' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('q=');
    expect(screen.getByText(/1 resultado/i)).toBeInTheDocument();
    // La búsqueda es local: no hay una petición por pulsación.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('busca por nombre de alternativa y muestra sus SaaS relacionados', async () => {
    const { user } = renderApp('/');
    await user.type(await screen.findByRole('searchbox'), 'FOTERO');
    const alternatives = alternativesSection();
    const card = within(alternatives).getByRole('heading', { name: 'Fotero' }).closest('article');
    expect(within(card).getByRole('link', { name: 'Fotos Nube' })).toHaveAttribute('href', '/saas/fotos');
    expect(screen.queryByRole('region', { name: /servicios saas/i })).not.toBeInTheDocument();
  });

  it('acepta una URL compartible con q', async () => {
    renderApp('/?q=%20GITERO%20');
    const input = await screen.findByRole('searchbox');
    expect(input).toHaveValue(' GITERO ');
    expect(within(alternativesSection()).getByRole('heading', { name: 'Gitero' })).toBeInTheDocument();
    expect(within(alternativesSection()).queryByRole('heading', { name: 'Archivero' })).not.toBeInTheDocument();
  });

  it('un q vacío o de espacios muestra el catálogo completo', async () => {
    renderApp('/?q=%20%20%20');
    await screen.findByRole('searchbox');
    expect(within(servicesSection()).getAllByRole('article')).toHaveLength(3);
    expect(within(alternativesSection()).getAllByRole('article')).toHaveLength(4);
  });

  it('muestra estado sin coincidencias y permite restablecer', async () => {
    const { user } = renderApp('/');
    const input = await screen.findByRole('searchbox');
    await user.type(input, 'inexistente');
    expect(screen.getByRole('heading', { name: /sin resultados/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /restablecer búsqueda/i }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(within(servicesSection()).getAllByRole('article')).toHaveLength(3);
  });

  it('el enlace Catálogo de la cabecera limpia la búsqueda (navegación externa)', async () => {
    const { user } = renderApp('/?q=gitero');
    const input = await screen.findByRole('searchbox');
    expect(input).toHaveValue('gitero');
    await user.click(screen.getByRole('link', { name: 'Catálogo' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(within(servicesSection()).getAllByRole('article')).toHaveLength(3);
  });

  it('distingue el error con reintento del catálogo vacío', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new CatalogLoadError('http', 'El servidor respondió con el estado 500.', 500))
      .mockResolvedValueOnce(catalogFixture());
    const { user } = renderApp('/', { fetcher });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no se pudo cargar el catálogo/i);
    expect(screen.queryByText(/todavía no tiene/i)).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('region', { name: /servicios saas/i })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('muestra un estado vacío propio cuando el catálogo no tiene registros', async () => {
    renderApp('/', { data: emptyCatalog() });
    expect(await screen.findByRole('heading', { name: /todavía no tiene alternativas/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restablecer/i })).not.toBeInTheDocument();
  });
});

describe('US1: página de SaaS', () => {
  it('navega a un SaaS y muestra alternativas con su cobertura', async () => {
    const { user } = renderApp('/');
    await user.click(await within(await screen.findByRole('region', { name: /servicios saas/i })).findByRole('link', { name: 'Forja Nube' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Forja Nube' })).toBeInTheDocument();
    expect(screen.getByText('Aloja repositorios con revisión.')).toBeInTheDocument();
    expect(screen.getByText('Aloja repositorios con incidencias.')).toBeInTheDocument();
    expect(screen.getByText(/no garantiza una equivalencia completa/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver al catálogo/i })).toHaveAttribute('href', '/');
  });

  it('un SaaS inexistente muestra no encontrado con enlace al catálogo', async () => {
    renderApp('/saas/no-existe');
    expect(await screen.findByRole('heading', { level: 1, name: /no encontramos este saas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver al catálogo/i })).toHaveAttribute('href', '/');
  });

  it('la página de SaaS también distingue error de carga', async () => {
    renderApp('/saas/forja', { fetcher: vi.fn().mockRejectedValue(new CatalogLoadError('network', 'sin red')) });
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar/i);
    expect(screen.queryByText(/no encontramos/i)).not.toBeInTheDocument();
  });
});

describe('navegación accesible', () => {
  it('ofrece enlace para saltar al contenido y navegación con nombre', async () => {
    renderApp('/');
    await screen.findByRole('searchbox');
    expect(screen.getByRole('link', { name: /saltar al contenido/i })).toHaveAttribute('href', '#contenido');
    expect(screen.getByRole('navigation', { name: /principal/i })).toBeInTheDocument();
  });
});
