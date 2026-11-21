import { screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { renderApp, resetSelection } from './helpers.jsx';

beforeEach(() => resetSelection());

// Regresión: el nombre accesible del botón debe separar el nombre de la
// alternativa del resto del texto ("Archiveroa" era un error real).
it('los botones de selección tienen nombres accesibles bien formados', async () => {
  renderApp('/');
  await screen.findByRole('searchbox');
  const names = [];
  screen.queryAllByRole('button', {
    name: (name) => {
      names.push(name);
      return false;
    },
  });
  expect(names).toEqual([
    'Añadir Archivero a la comparación',
    'Añadir Fotero a la comparación',
    'Añadir Gitero a la comparación',
    'Añadir GitLibre a la comparación',
  ]);
});
