import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useComparison } from '../src/store/comparison.js';
import { renderApp, resetSelection } from './helpers.jsx';

beforeEach(() => resetSelection());

const addButton = (name) => screen.getByRole('button', { name: `Añadir ${name} a la comparación` });
const removeButton = (name) => screen.getByRole('button', { name: `Quitar ${name} de la comparación` });
const counter = () => screen.getByTestId('selection-count');

describe('US3: selección', () => {
  it('con cero seleccionadas explica cuántas faltan y no muestra tabla', async () => {
    renderApp('/comparar');
    expect(await screen.findByRole('heading', { level: 1, name: /comparar alternativas/i })).toBeInTheDocument();
    expect(screen.getByText(/selecciona al menos 2 alternativas/i)).toBeInTheDocument();
    expect(screen.getByText(/faltan 2/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir al catálogo/i })).toHaveAttribute('href', '/');
  });

  it('con una seleccionada indica que falta una', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Añadir Archivero a la comparación' }));
    expect(removeButton('Archivero')).toHaveAttribute('aria-pressed', 'true');
    expect(counter()).toHaveTextContent('1 de 3');
    await user.click(screen.getByRole('link', { name: /^comparar/i }));
    expect(await screen.findByText(/falta 1/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('compara dos alternativas del mismo SaaS con criterios alineados', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Añadir Gitero a la comparación' }));
    await user.click(addButton('GitLibre'));
    await user.click(screen.getByRole('link', { name: /^comparar/i }));
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: /gitero/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /gitlibre/i })).toBeInTheDocument();
    for (const criterion of [/sustituye a/i, /capacidades/i, /limitaciones/i, /licencia/i, /dificultad/i, /requisitos de autoalojamiento/i, /fuentes/i]) {
      const row = within(table).getByRole('rowheader', { name: criterion }).closest('tr');
      expect(within(row).getAllByRole('cell')).toHaveLength(2);
    }
    expect(screen.queryByText(/cubren necesidades distintas/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /tabla de comparación/i })).toHaveAttribute('tabindex', '0');
  });

  it('avisa cuando las alternativas cubren necesidades distintas', async () => {
    resetSelection(['archivero', 'gitero']);
    renderApp('/comparar');
    await screen.findByRole('table');
    expect(screen.getByText(/cubren necesidades distintas/i)).toBeInTheDocument();
  });

  it('no permite una cuarta selección y pide retirar una', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Añadir Archivero a la comparación' }));
    await user.click(addButton('Fotero'));
    await user.click(addButton('Gitero'));
    expect(counter()).toHaveTextContent('3 de 3');
    await user.click(addButton('GitLibre'));
    expect(screen.getByRole('alert')).toHaveTextContent(/máximo de 3.*retira una/i);
    expect(addButton('GitLibre')).toHaveAttribute('aria-pressed', 'false');
    expect(useComparison.getState().ids).toEqual(['archivero', 'fotero', 'gitero']);
    expect(counter()).toHaveTextContent('3 de 3');
  });

  it('el mismo estado se refleja en catálogo y ficha sin duplicar', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Añadir Gitero a la comparación' }));
    const alternatives = screen.getByRole('region', { name: /^alternativas/i });
    await user.click(within(alternatives).getByRole('link', { name: 'Gitero' }));
    await screen.findByRole('heading', { level: 1, name: 'Gitero' });
    expect(removeButton('Gitero')).toHaveAttribute('aria-pressed', 'true');
    expect(useComparison.getState().ids).toEqual(['gitero']);
  });

  it('conserva la selección al navegar y permite quitar y limpiar', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Añadir Archivero a la comparación' }));
    await user.click(addButton('Fotero'));
    await user.click(addButton('Gitero'));
    await user.click(within(screen.getByRole('region', { name: /servicios saas/i })).getByRole('link', { name: 'Forja Nube' }));
    await screen.findByRole('heading', { level: 1, name: 'Forja Nube' });
    expect(counter()).toHaveTextContent('3 de 3');
    await user.click(screen.getByRole('link', { name: /^comparar/i }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    await user.click(within(table).getByRole('button', { name: 'Quitar Fotero de la comparación' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /limpiar selección/i }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(counter()).toHaveTextContent('0 de 3');
    expect(screen.getByText(/faltan 2/i)).toBeInTheDocument();
  });

  it('retira IDs que ya no existen y lo avisa conservando los válidos', async () => {
    resetSelection(['archivero', 'retirada', 'gitero']);
    renderApp('/comparar');
    await screen.findByRole('table');
    expect(screen.getByRole('status', { name: /aviso de selección/i })).toHaveTextContent(/se retiró 1 alternativa/i);
    expect(useComparison.getState().ids).toEqual(['archivero', 'gitero']);
  });
});
