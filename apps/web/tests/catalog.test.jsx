import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatalogLoadError } from '../src/api/catalog.js';
import { catalogFixture, emptyCatalog } from './fixtures.js';
import { renderApp } from './helpers.jsx';

const servicesSection = () => screen.getByRole('region', { name: /elige un servicio|servicios que coinciden/i });
const circles = () => within(servicesSection()).getAllByRole('button', { name: /alternativas?$/ });
const circle = (name) => screen.getByRole('button', { name: new RegExp(`^${name} \\d+ alternativas?$`) });
const tree = (service) => screen.getByRole('region', { name: `Alternativas a ${service}` });

describe('US1: catálogo público', () => {
  it('muestra carga y después los servicios como círculos sin pedir cuenta', async () => {
    renderApp('/');
    expect(screen.getByText(/cargando el catálogo/i).closest('[role="status"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeInTheDocument();
    expect(circles().map((button) => button.querySelector('.orbit__name').textContent)).toEqual(['Drive Nube', 'Fotos Nube', 'Forja Nube']);
    expect(circles().map((button) => button.querySelector('.orbit__mark').textContent)).toEqual(['DN', 'FN', 'FN']);
    for (const button of circles()) expect(button).toHaveAttribute('aria-expanded', 'false');
    // Sin servicio abierto no hay árbol ni comparativa.
    expect(screen.queryByRole('region', { name: /^alternativas a/i })).not.toBeInTheDocument();
    // Desde 003 la cabecera ofrece Entrar/Crear cuenta (contracts/ui.md); el
    // catálogo en sí sigue sin pedir cuenta.
    expect(within(screen.getByRole('main')).queryByText(/iniciar sesión|registrarse|crear cuenta/i)).not.toBeInTheDocument();
  });

  it('busca un servicio ignorando mayúsculas y espacios, refleja q y abre su único resultado', async () => {
    const { user, fetcher } = renderApp('/');
    const input = await screen.findByRole('searchbox', { name: 'Encuentra una alternativa' });
    await user.type(input, '  forja NUBE ');
    expect(circles()).toHaveLength(1);
    expect(circle('Forja Nube')).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree('Forja Nube')).getByRole('button', { name: 'Gitero' })).toBeInTheDocument();
    expect(within(tree('Forja Nube')).getByRole('button', { name: 'GitLibre' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('q=');
    expect(screen.getByText(/1 servicio para/i)).toBeInTheDocument();
    // La búsqueda es local: no hay una petición por pulsación.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('busca por nombre de alternativa y muestra el servicio que sustituye', async () => {
    const { user } = renderApp('/');
    await user.type(await screen.findByRole('searchbox'), 'FOTERO');
    expect(circles()).toHaveLength(1);
    expect(circle('Fotos Nube')).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree('Fotos Nube')).getByRole('button', { name: 'Fotero' })).toBeInTheDocument();
  });

  it('acepta una URL compartible con q', async () => {
    renderApp('/?q=%20GITERO%20');
    const input = await screen.findByRole('searchbox');
    expect(input).toHaveValue(' GITERO ');
    expect(circles()).toHaveLength(1);
    expect(within(tree('Forja Nube')).getByRole('button', { name: 'Gitero' })).toBeInTheDocument();
  });

  it('un q vacío o de espacios muestra el catálogo completo', async () => {
    renderApp('/?q=%20%20%20');
    await screen.findByRole('searchbox');
    expect(circles()).toHaveLength(3);
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
    expect(circles()).toHaveLength(3);
  });

  it('el enlace Catálogo de la cabecera limpia la búsqueda (navegación externa)', async () => {
    const { user } = renderApp('/?q=gitero');
    const input = await screen.findByRole('searchbox');
    expect(input).toHaveValue('gitero');
    await user.click(screen.getByRole('link', { name: 'Catálogo' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(circles()).toHaveLength(3);
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
    expect(await screen.findByRole('region', { name: 'Elige un servicio' })).toBeInTheDocument();
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
  it('navega a un SaaS desde su árbol y muestra alternativas con su cobertura', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: /^Forja Nube/ }));
    await user.click(within(tree('Forja Nube')).getByRole('link', { name: 'Página de Forja Nube' }));
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
