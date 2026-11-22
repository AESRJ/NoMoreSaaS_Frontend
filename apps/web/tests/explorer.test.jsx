import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { alternative, catalogFixture } from './fixtures.js';
import { renderApp } from './helpers.jsx';

const circle = (name) => screen.getByRole('button', { name: new RegExp(`^${name} \\d+ alternativas?$`) });
const tree = (service) => screen.getByRole('region', { name: `Alternativas a ${service}` });
const comparison = (service, alt) => screen.getByRole('region', { name: `${service} frente a ${alt}` });

describe('US2: árbol por servicio y comparativa en la misma página', () => {
  it('círculo → alternativa → comparativa con fuentes y desconocidos explícitos', async () => {
    const data = catalogFixture();
    data.services[0] = {
      ...data.services[0],
      officialUrl: 'https://drive.example.org/',
      sources: [{ url: 'https://drive.example.org/producto', checkedAt: '2026-11-20', kind: 'official', note: 'Página oficial del producto.' }],
    };
    const { user } = renderApp('/', { data });
    await user.click(await screen.findByRole('button', { name: /^Drive Nube/ }));
    expect(circle('Drive Nube')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Drive Nube: 1 alternativa.')).toBeInTheDocument();

    const branch = tree('Drive Nube');
    const node = within(branch).getByRole('button', { name: 'Archivero' });
    expect(node).toHaveAttribute('aria-expanded', 'false');
    await user.click(node);
    expect(node).toHaveAttribute('aria-expanded', 'true');

    const panel = comparison('Drive Nube', 'Archivero');
    expect(node).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByText('Archivos en la nube.')).toBeInTheDocument();
    expect(within(panel).getByText('Sincroniza y comparte archivos.')).toBeInTheDocument();
    expect(within(panel).getByText('Capacidad principal de Archivero')).toBeInTheDocument();
    expect(within(panel).getByText(/desconocido: el catálogo no documenta sus capacidades/i)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Fuente oficial de Drive Nube' })).toHaveAttribute('href', 'https://drive.example.org/producto');
    expect(within(panel).getByText('Página oficial del producto.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Ver ficha completa de Archivero' })).toHaveAttribute('href', '/alternativas/archivero');
    expect(screen.getByText('Comparando Drive Nube con Archivero.')).toBeInTheDocument();
    // Misma ruta: no se pasa por /comparar.
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('un servicio sin fuentes las declara desconocidas en lugar de inventarlas', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: /^Fotos Nube/ }));
    await user.click(within(tree('Fotos Nube')).getByRole('button', { name: 'Fotero' }));
    expect(within(comparison('Fotos Nube', 'Fotero')).getByText('Sin fuente oficial registrada para Fotos Nube.')).toBeInTheDocument();
  });

  it('cambiar de servicio cierra la comparativa incompatible y volver a pulsar cierra el árbol', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: /^Forja Nube/ }));
    await user.click(within(tree('Forja Nube')).getByRole('button', { name: 'Gitero' }));
    expect(comparison('Forja Nube', 'Gitero')).toBeInTheDocument();
    // Cambiar de alternativa dentro del mismo servicio.
    await user.click(within(tree('Forja Nube')).getByRole('button', { name: 'GitLibre' }));
    expect(screen.queryByRole('region', { name: 'Forja Nube frente a Gitero' })).not.toBeInTheDocument();
    expect(comparison('Forja Nube', 'GitLibre')).toBeInTheDocument();

    await user.click(circle('Drive Nube'));
    expect(circle('Forja Nube')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /frente a/ })).not.toBeInTheDocument();
    expect(tree('Drive Nube')).toBeInTheDocument();

    await user.click(circle('Drive Nube'));
    expect(circle('Drive Nube')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /^alternativas a/i })).not.toBeInTheDocument();
  });

  it('se recorre con teclado: Tab hasta el círculo, Enter abre y Espacio compara', async () => {
    const { user } = renderApp('/');
    const target = await screen.findByRole('button', { name: /^Drive Nube/ });
    target.focus();
    await user.keyboard('{Enter}');
    expect(target).toHaveAttribute('aria-expanded', 'true');
    // El foco no salta: el siguiente Tab recorre círculos y luego el árbol.
    expect(target).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(within(tree('Drive Nube')).getByRole('link', { name: 'Página de Drive Nube' })).toHaveFocus();
    await user.tab();
    const node = within(tree('Drive Nube')).getByRole('button', { name: 'Archivero' });
    expect(node).toHaveFocus();
    await user.keyboard(' ');
    expect(comparison('Drive Nube', 'Archivero')).toBeInTheDocument();
  });

  it('cerrar el único resultado de una búsqueda se respeta hasta la siguiente búsqueda', async () => {
    const { user } = renderApp('/?q=drive');
    const target = await screen.findByRole('button', { name: /^Drive Nube/ });
    expect(target).toHaveAttribute('aria-expanded', 'true');
    await user.click(target);
    expect(target).toHaveAttribute('aria-expanded', 'false');
    await user.type(screen.getByRole('searchbox'), ' ');
    expect(screen.getByRole('button', { name: /^Drive Nube/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('una licencia source-available se distingue visiblemente en la comparativa', async () => {
    const data = catalogFixture();
    data.alternatives[0] = {
      ...alternative('archivero', 'Archivero'),
      license: { label: 'BSL 1.1', url: 'https://archivero.example.org/license', classification: 'source-available' },
    };
    const { user } = renderApp('/', { data });
    await user.click(await screen.findByRole('button', { name: /^Drive Nube/ }));
    await user.click(within(tree('Drive Nube')).getByRole('button', { name: 'Archivero' }));
    expect(within(comparison('Drive Nube', 'Archivero')).getByText('Código disponible (no open source)')).toBeInTheDocument();
  });

  it('el texto del catálogo se muestra como texto, nunca como HTML', async () => {
    const data = catalogFixture();
    data.services[0] = { ...data.services[0], description: '<img src=x onerror="window.__xss=3">' };
    const { user, container } = renderApp('/', { data });
    await user.click(await screen.findByRole('button', { name: /^Drive Nube/ }));
    await user.click(within(tree('Drive Nube')).getByRole('button', { name: 'Archivero' }));
    expect(screen.getByText('<img src=x onerror="window.__xss=3">')).toBeInTheDocument();
    expect(container.querySelector('.comparison img')).toBeNull();
    expect(window.__xss).toBeUndefined();
  });
});

describe('interfaz global de comparación retirada', () => {
  it('no hay menú Comparar, botones de añadir ni banda de selección', async () => {
    renderApp('/');
    await screen.findByRole('searchbox');
    expect(within(screen.getByRole('navigation', { name: /principal/i })).queryByRole('link', { name: /comparar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /a la comparación/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /selección para comparar/i })).not.toBeInTheDocument();
  });

  it('las fichas siguen consultables y sin botones de selección global', async () => {
    renderApp('/alternativas/gitero');
    expect(await screen.findByRole('heading', { level: 1, name: 'Gitero' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comparación/i })).not.toBeInTheDocument();
  });

  it.each(['/comparar', '/comparar?ids=gitero,gitlibre'])('%s redirige al catálogo con un aviso', async (path) => {
    renderApp(path);
    expect(await screen.findByText(/la comparación ahora está dentro de cada servicio/i)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(screen.getByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeInTheDocument();
  });
});
